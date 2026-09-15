/**
 * Motore di parsing dei rendiconti provvigioni, guidato dalla mappatura.
 *
 * Un solo motore per tutte le fonti: quello che cambia è la configurazione
 * (`PayoutTemplateConfig`), non il codice. Le scelte non ovvie rispondono a
 * insidie osservate nei file reali, elencate in
 * `docs/provvigioni-formati-e-import.md` §1.8.
 */

import ExcelJS from "exceljs";
import { periodFromSheetName } from "@/lib/helios-provvigioni-shared";
import {
  cellText,
  isFormulaWithoutResult,
  isMaskedPod,
  looksLikeTotalRow,
  maskedPodSuffix,
  normalizeFiscalKey,
  parseAmount,
  parsePeriodCell,
  personKeyVariants,
  podCandidateKeys,
  type RawCell,
} from "@/lib/payout/normalize";
import type {
  ParsedPayoutRow,
  ParsePayoutResult,
  PayoutColumnMap,
  PayoutTemplateConfig,
} from "@/lib/payout/types";

/** Righe ispezionate alla ricerca dell'intestazione quando headerRow = 0. */
const HEADER_SCAN_ROWS = 12;

/** Tetto di sicurezza: nessun rendiconto reale supera questo numero di righe. */
const MAX_DATA_ROWS = 20000;

function normalizeHeader(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s./'-]/g, "")
    .trim();
}

function columnLetterToNumber(letter: string): number | null {
  if (!/^[A-Za-z]{1,3}$/.test(letter)) return null;
  let n = 0;
  for (const ch of letter.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

type SheetHeaders = {
  /** Intestazione normalizzata → numero di colonna */
  byName: Map<string, number>;
  /** Ultima colonna effettivamente valorizzata: i fogli dichiarano migliaia di colonne vuote */
  lastCol: number;
  /** Intestazione originale per numero di colonna, per il raw della riga */
  labels: Map<number, string>;
};

function readHeaders(sheet: ExcelJS.Worksheet, rowNumber: number): SheetHeaders {
  const row = sheet.getRow(rowNumber);
  const byName = new Map<string, number>();
  const labels = new Map<number, string>();
  let lastCol = 0;
  row.eachCell({ includeEmpty: false }, (cell, col) => {
    const text = cellText(cell.value as RawCell);
    if (!text) return;
    const key = normalizeHeader(text);
    if (key && !byName.has(key)) byName.set(key, col);
    labels.set(col, text);
    if (col > lastCol) lastCol = col;
  });
  return { byName, lastCol, labels };
}

/**
 * Risolve un riferimento di colonna: prima per intestazione (esatta, poi
 * contenuta), infine come lettera. L'ordine conta: in un file una colonna può
 * chiamarsi «L» e non essere la dodicesima.
 */
function resolveColumn(
  headers: SheetHeaders,
  ref: string | undefined,
): number | null {
  if (!ref) return null;
  const key = normalizeHeader(ref);
  if (!key) return null;

  const exact = headers.byName.get(key);
  if (exact != null) return exact;

  for (const [name, col] of headers.byName) {
    if (name === key) return col;
  }
  for (const [name, col] of headers.byName) {
    if (name.includes(key) || key.includes(name)) return col;
  }
  return columnLetterToNumber(ref);
}

type SingleColumnField = Exclude<keyof PayoutColumnMap, "amountComponents">;

type ResolvedColumns = Partial<Record<SingleColumnField, number>> & {
  amountComponents: number[];
};

function resolveColumns(
  headers: SheetHeaders,
  map: PayoutColumnMap,
): ResolvedColumns {
  const out: ResolvedColumns = { amountComponents: [] };
  const single: SingleColumnField[] = [
    "pod",
    "clientName",
    "clientFirstName",
    "clientLastName",
    "fiscalCode",
    "amount",
    "period",
    "supplier",
    "collaborator",
    "note",
    "status",
  ];
  for (const field of single) {
    const ref = map[field];
    if (typeof ref !== "string") continue;
    const col = resolveColumn(headers, ref);
    if (col != null) out[field] = col;
  }
  for (const ref of map.amountComponents ?? []) {
    const col = resolveColumn(headers, ref);
    if (col != null) out.amountComponents.push(col);
  }
  return out;
}

/**
 * Trova la riga di intestazione contando quante colonne attese compaiono:
 * nei fogli compilati a mano l'intestazione sta in riga 3, 4 o 5.
 */
function detectHeaderRow(
  sheet: ExcelJS.Worksheet,
  map: PayoutColumnMap,
): number {
  const expected = [
    map.pod,
    map.clientName,
    map.clientFirstName,
    map.clientLastName,
    map.amount,
    map.period,
    map.supplier,
    map.collaborator,
  ]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .map(normalizeHeader);

  if (expected.length === 0) return 1;

  let bestRow = 1;
  let bestScore = -1;
  const limit = Math.min(sheet.rowCount, HEADER_SCAN_ROWS);
  for (let r = 1; r <= limit; r++) {
    const headers = readHeaders(sheet, r);
    let score = 0;
    for (const want of expected) {
      for (const [name] of headers.byName) {
        if (name === want || name.includes(want) || want.includes(name)) {
          score++;
          break;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }
  return bestRow;
}

function sheetSelected(
  name: string,
  match: PayoutTemplateConfig["sheetMatch"],
): boolean {
  const lower = name.toLowerCase();
  for (const skip of match.skip ?? []) {
    if (lower.includes(skip.toLowerCase())) return false;
  }
  if (match.mode === "exact") {
    return match.value != null && lower === match.value.toLowerCase();
  }
  if (match.mode === "regex") {
    if (!match.value) return true;
    try {
      return new RegExp(match.value, "i").test(name);
    } catch {
      return false;
    }
  }
  return true;
}

function sheetSignFor(
  sheetName: string,
  config: PayoutTemplateConfig,
): number {
  let sign = config.numberFormat.invertAll ? -1 : 1;
  const overrides = config.numberFormat.sheetSign ?? {};
  for (const [name, value] of Object.entries(overrides)) {
    if (sheetName.toLowerCase().includes(name.toLowerCase())) {
      sign *= value;
      break;
    }
  }
  return sign;
}

function readDeclaredTotal(
  workbook: ExcelJS.Workbook,
  config: PayoutTemplateConfig,
  totalRowAmounts: number[],
): number | null {
  const spec = config.declaredTotal;
  if (spec.mode === "none") return null;

  if (spec.mode === "total_rows") {
    if (totalRowAmounts.length === 0) return null;
    return totalRowAmounts.reduce((a, b) => a + b, 0);
  }

  const sheet = spec.sheet
    ? workbook.worksheets.find((s) =>
        s.name.toLowerCase().includes(spec.sheet!.toLowerCase()),
      )
    : workbook.worksheets[0];
  if (!sheet) return null;

  if (spec.mode === "sheet_cell" && spec.cell) {
    return parseAmount(sheet.getCell(spec.cell).value as RawCell);
  }

  if (spec.mode === "label_lookup" && spec.label) {
    const wanted = normalizeHeader(spec.label);
    const limit = Math.min(sheet.rowCount, 200);
    for (let r = 1; r <= limit; r++) {
      const row = sheet.getRow(r);
      let labelCol: number | null = null;
      row.eachCell({ includeEmpty: false }, (cell, col) => {
        if (labelCol != null) return;
        const text = normalizeHeader(cellText(cell.value as RawCell));
        if (text && (text === wanted || text.includes(wanted))) labelCol = col;
      });
      if (labelCol == null) continue;
      // L'importo è nella prima cella numerica a destra dell'etichetta
      for (let c = labelCol + 1; c <= labelCol + 12; c++) {
        const amount = parseAmount(row.getCell(c).value as RawCell);
        if (amount != null) return amount;
      }
    }
  }
  return null;
}

function buildRawRow(
  row: ExcelJS.Row,
  headers: SheetHeaders,
): Record<string, string> {
  const raw: Record<string, string> = {};
  for (let c = 1; c <= headers.lastCol; c++) {
    const text = cellText(row.getCell(c).value as RawCell);
    if (!text) continue;
    const label = headers.labels.get(c) ?? `col_${c}`;
    raw[label] = text.slice(0, 200);
  }
  return raw;
}

function amountForRow(
  row: ExcelJS.Row,
  cols: ResolvedColumns,
): number | null {
  if (cols.amount != null) {
    const cell = row.getCell(cols.amount).value as RawCell;
    const direct = parseAmount(cell);
    // Formula senza risultato memorizzato: ricalcolo dalle componenti dichiarate
    if (direct != null && !isFormulaWithoutResult(cell)) return direct;
  }
  if (cols.amountComponents.length > 0) {
    let sum = 0;
    let found = false;
    for (const col of cols.amountComponents) {
      const value = parseAmount(row.getCell(col).value as RawCell);
      if (value != null) {
        sum += value;
        found = true;
      }
    }
    if (found) return sum;
  }
  if (cols.amount != null) {
    return parseAmount(row.getCell(cols.amount).value as RawCell);
  }
  return null;
}

/** Legge un rendiconto XLSX applicando la mappatura della fonte. */
export async function parsePayoutWorkbook(
  buffer: Buffer,
  config: PayoutTemplateConfig,
): Promise<ParsePayoutResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    return { ok: false, error: "Impossibile leggere il file Excel" };
  }

  const sheets = workbook.worksheets.filter(
    (s) => s.state !== "hidden" && sheetSelected(s.name, config.sheetMatch),
  );
  if (sheets.length === 0) {
    return {
      ok: false,
      error:
        "Nessun foglio corrisponde alla mappatura: controlla la regola di scelta dei fogli",
    };
  }

  const rows: ParsedPayoutRow[] = [];
  const skipped: Array<{ sheetName: string; rowIndex: number; reason: string }> =
    [];
  const sheetsRead: string[] = [];
  const totalRowAmounts: number[] = [];
  const missingBySheet = new Map<string, string[]>();

  for (const sheet of sheets) {
    const headerRow =
      config.headerRow > 0
        ? config.headerRow
        : detectHeaderRow(sheet, config.columnMap);
    const headers = readHeaders(sheet, headerRow);
    const cols = resolveColumns(headers, config.columnMap);

    // Un foglio senza le colonne chiave non è un foglio dati (riepiloghi, note)
    const missing: string[] = [];
    for (const field of config.skipRules.requireColumns ?? []) {
      if (field === "amount") {
        if (cols.amount == null && cols.amountComponents.length === 0) {
          missing.push(String(config.columnMap.amount ?? "importo"));
        }
        continue;
      }
      if (cols[field] == null) {
        missing.push(String(config.columnMap[field] ?? field));
      }
    }
    if (missing.length > 0) {
      missingBySheet.set(sheet.name, missing);
      continue;
    }

    sheetsRead.push(sheet.name);
    const sign = sheetSignFor(sheet.name, config);
    const sheetPeriod = periodFromSheetName(sheet.name);
    const lastRow = Math.min(sheet.rowCount, headerRow + MAX_DATA_ROWS);

    for (let r = headerRow + 1; r <= lastRow; r++) {
      const row = sheet.getRow(r);

      const texts: string[] = [];
      for (let c = 1; c <= headers.lastCol; c++) {
        texts.push(cellText(row.getCell(c).value as RawCell));
      }
      if (texts.every((t) => !t)) continue;

      if (looksLikeTotalRow(texts)) {
        const amount = amountForRow(row, cols);
        if (amount != null) totalRowAmounts.push(amount * sign);
        if (config.skipRules.stopAtTotalRow) {
          // Chiude il foglio: sotto il totale ci sono annotazioni manuali,
          // non dati della fonte
          break;
        }
        skipped.push({ sheetName: sheet.name, rowIndex: r, reason: "totale" });
        continue;
      }

      if (config.skipRules.allowedStatus?.length && cols.status != null) {
        const status = cellText(row.getCell(cols.status).value as RawCell);
        const allowed = config.skipRules.allowedStatus.some(
          (s) => s.toLowerCase() === status.toLowerCase(),
        );
        if (!allowed) {
          skipped.push({
            sheetName: sheet.name,
            rowIndex: r,
            reason: `stato «${status || "vuoto"}» escluso`,
          });
          continue;
        }
      }

      const podRaw =
        cols.pod != null ? cellText(row.getCell(cols.pod).value as RawCell) : "";
      const clientNameRaw =
        cols.clientName != null
          ? cellText(row.getCell(cols.clientName).value as RawCell)
          : "";
      const firstName =
        cols.clientFirstName != null
          ? cellText(row.getCell(cols.clientFirstName).value as RawCell)
          : "";
      const lastName =
        cols.clientLastName != null
          ? cellText(row.getCell(cols.clientLastName).value as RawCell)
          : "";
      const amountRaw = amountForRow(row, cols);

      let missingRequired = "";
      for (const field of config.skipRules.requireColumns ?? []) {
        if (field === "pod" && !podRaw) missingRequired = "POD assente";
        if (field === "amount" && amountRaw == null) {
          missingRequired = "importo non numerico";
        }
        if (field === "clientName" && !clientNameRaw && !lastName) {
          missingRequired = "cliente assente";
        }
        if (missingRequired) break;
      }
      if (missingRequired) {
        skipped.push({
          sheetName: sheet.name,
          rowIndex: r,
          reason: missingRequired,
        });
        continue;
      }

      const periodCell =
        cols.period != null ? (row.getCell(cols.period).value as RawCell) : null;
      const period =
        (periodCell != null
          ? parsePeriodCell(periodCell, config.dateFormat)
          : null) ?? sheetPeriod;

      rows.push({
        sheetName: sheet.name,
        rowIndex: r,
        raw: buildRawRow(row, headers),
        podRaw,
        podKeys: isMaskedPod(podRaw) ? [] : podCandidateKeys(podRaw),
        podMaskedSuffix: isMaskedPod(podRaw) ? maskedPodSuffix(podRaw) : "",
        clientNameRaw:
          clientNameRaw || [firstName, lastName].filter(Boolean).join(" "),
        personKeys: personKeyVariants({
          full: clientNameRaw,
          first: firstName,
          last: lastName,
        }),
        fiscalKey:
          cols.fiscalCode != null
            ? normalizeFiscalKey(
                cellText(row.getCell(cols.fiscalCode).value as RawCell),
              )
            : "",
        supplierHint:
          cols.supplier != null
            ? cellText(row.getCell(cols.supplier).value as RawCell)
            : "",
        collaboratorHint:
          cols.collaborator != null
            ? cellText(row.getCell(cols.collaborator).value as RawCell)
            : "",
        amount: amountRaw == null ? null : amountRaw * sign,
        period,
        note:
          cols.note != null
            ? cellText(row.getCell(cols.note).value as RawCell).slice(0, 200)
            : "",
      });
    }
  }

  if (sheetsRead.length === 0) {
    const missing = [...new Set([...missingBySheet.values()].flat())];
    return {
      ok: false,
      error:
        "Colonne attese non trovate nel file: la mappatura non corrisponde a questo formato",
      missingColumns: missing,
    };
  }

  if (rows.length === 0) {
    return {
      ok: false,
      error: `Nessuna riga di dati nei fogli ${sheetsRead.join(", ")}`,
    };
  }

  return {
    ok: true,
    rows,
    computedTotal: rows.reduce((sum, r) => sum + (r.amount ?? 0), 0),
    declaredTotal: readDeclaredTotal(workbook, config, totalRowAmounts),
    sheetsRead,
    skipped,
  };
}
