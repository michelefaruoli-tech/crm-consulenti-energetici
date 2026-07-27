import ExcelJS from "exceljs";
import { normalizePodKey } from "@/lib/storno-status";
import { periodFromSheetName } from "@/lib/helios-provvigioni-shared";

export type ParsedHeliosLine = {
  excelRow: number;
  pod: string;
  intestatario: string;
  baseAmount: number;
  competencePeriod: string;
};

function cellStr(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const o = value as {
      text?: unknown;
      result?: unknown;
      richText?: Array<{ text?: string }>;
    };
    if (Array.isArray(o.richText)) {
      return o.richText.map((t) => t.text ?? "").join("");
    }
    if (o.text != null) return cellStr(o.text);
    if (o.result != null) return cellStr(o.result);
  }
  return String(value).trim();
}

function cellNum(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = cellStr(value).replace(",", ".").replace(/[^\d.-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function headerIndex(headers: Array<string | undefined>, ...names: string[]): number {
  for (const name of names) {
    const i = headers.findIndex((h) => h != null && h === name);
    if (i >= 0) return i;
  }
  for (const name of names) {
    const i = headers.findIndex((h) => h != null && h.includes(name));
    if (i >= 0) return i;
  }
  return -1;
}

function findHeliosDataSheets(
  workbook: ExcelJS.Workbook,
): Array<{ sheet: ExcelJS.Worksheet; sheetPeriod: string | null }> {
  const out: Array<{ sheet: ExcelJS.Worksheet; sheetPeriod: string | null }> =
    [];

  for (const sheet of workbook.worksheets) {
    if (/riepilogo/i.test(sheet.name)) continue;

    const headerRow = sheet.getRow(1);
    const headers: Array<string | undefined> = [];
    headerRow.eachCell((c, col) => {
      headers[col] = cellStr(c.value).toLowerCase();
    });

    const colPod = headerIndex(
      headers,
      "cod.ute.",
      "cod.ute",
      "cod ute",
      "pod",
      "pdr",
    );
    if (colPod >= 0) {
      out.push({
        sheet,
        sheetPeriod: periodFromSheetName(sheet.name),
      });
    }
  }

  if (out.length > 0) return out;

  const legacy = workbook.worksheets.find((s) =>
    /dettaglio|vendite/i.test(s.name),
  );
  if (legacy) {
    return [{ sheet: legacy, sheetPeriod: null }];
  }
  const first = workbook.worksheets[0];
  return first ? [{ sheet: first, sheetPeriod: null }] : [];
}

function readSheetHeaders(sheet: ExcelJS.Worksheet): Array<string | undefined> {
  const headerRow = sheet.getRow(1);
  const headers: Array<string | undefined> = [];
  headerRow.eachCell((c, col) => {
    headers[col] = cellStr(c.value).toLowerCase();
  });
  return headers;
}

export async function parseHeliosProvvigioniBuffer(
  buffer: Buffer,
  fallbackCompetence: string,
): Promise<{ ok: true; lines: ParsedHeliosLine[] } | { ok: false; error: string }> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    return { ok: false, error: "Impossibile leggere il file Excel" };
  }

  const dataSheets = findHeliosDataSheets(workbook);
  if (dataSheets.length === 0) {
    return { ok: false, error: "Foglio Excel vuoto" };
  }

  const lines: ParsedHeliosLine[] = [];
  const seenKeys = new Set<string>();
  let foundPodColumn = false;

  for (const { sheet, sheetPeriod } of dataSheets) {
    const headers = readSheetHeaders(sheet);

    const colPod = headerIndex(
      headers,
      "cod.ute.",
      "cod.ute",
      "cod ute",
      "pod",
      "pdr",
    );
    if (colPod < 0) continue;
    foundPodColumn = true;

    const colName = headerIndex(
      headers,
      "intestatario contratto",
      "intestatario",
      "cliente",
    );
    const colBase = headerIndex(
      headers,
      "provvigione base (regola 1)",
      "provvigione base",
      "provvigione",
    );

    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const podRaw = cellStr(row.getCell(colPod).value);
      const pod = normalizePodKey(podRaw);
      if (!pod) continue;

      const competencePeriod = sheetPeriod ?? fallbackCompetence;

      const dedupKey = `${pod}|${competencePeriod}`;
      if (seenKeys.has(dedupKey)) continue;
      seenKeys.add(dedupKey);

      const intestatario =
        colName >= 0 ? cellStr(row.getCell(colName).value) : "";
      const baseAmount = colBase >= 0 ? cellNum(row.getCell(colBase).value) : 0;

      lines.push({
        excelRow: r,
        pod,
        intestatario,
        baseAmount,
        competencePeriod,
      });
    }
  }

  if (!foundPodColumn) {
    return {
      ok: false,
      error:
        "Colonna Cod.Ute. (POD) non trovata. Attesi fogli mensili (es. Gennaio 2026) o «Dettaglio Vendite Dirette».",
    };
  }

  if (lines.length === 0) {
    return { ok: false, error: "Nessuna riga con POD nel file" };
  }
  return { ok: true, lines };
}
