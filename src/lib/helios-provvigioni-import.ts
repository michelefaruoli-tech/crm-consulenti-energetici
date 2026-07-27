"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { clientDisplayName } from "@/lib/utils";
import { normalizePodKey } from "@/lib/storno-status";
import { syncRecurringMonthsForContract } from "@/lib/recurring-sync";
import {
  guessCompetenceFromFilename,
  isYearMonthPeriod,
  normalizePersonKey,
  periodFromHeliosDate,
  periodFromSheetName,
  type HeliosImportPreviewRow,
  type HeliosImportPreviewResult,
} from "@/lib/helios-provvigioni-shared";

export type {
  HeliosImportPreviewRow,
  HeliosImportPreviewResult,
  HeliosImportRowStatus,
} from "@/lib/helios-provvigioni-shared";

type ParsedHeliosLine = {
  excelRow: number;
  pod: string;
  intestatario: string;
  baseAmount: number;
  /** Competenza riga (da colonna Inizio) oppure fallback file/form */
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

function headerIndex(headers: Array<string | undefined>, ...names: string[]): number {
  // ExcelJS usa colonne 1-based → headers[0] può essere undefined (array sparso)
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

async function bufferFromForm(formData: FormData): Promise<
  { ok: true; buffer: Buffer; fileName: string } | { ok: false; error: string }
> {
  const fileName = String(formData.get("fileName") ?? "").trim() || "helios.xlsx";
  const b64 = String(formData.get("fileBase64") ?? "").trim();
  let buffer: Buffer | null = null;
  if (b64) {
    try {
      buffer = Buffer.from(b64, "base64");
    } catch {
      return { ok: false, error: "File Excel non valido (base64)" };
    }
  } else {
    const file = formData.get("file");
    if (file instanceof Blob && file.size > 0) {
      buffer = Buffer.from(await file.arrayBuffer());
    }
  }
  if (!buffer || buffer.length === 0) {
    return { ok: false, error: "Seleziona un file Excel (.xlsx)" };
  }
  return { ok: true, buffer, fileName };
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
    const colInizio = headerIndex(
      headers,
      "inizio",
      "data inizio",
      "competenza",
      "periodo",
      "mese competenza",
      "mese",
    );

    const sheetFallback = sheetPeriod ?? fallbackCompetence;

    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const podRaw = cellStr(row.getCell(colPod).value);
      const pod = normalizePodKey(podRaw);
      if (!pod) continue;

      let competencePeriod = sheetFallback;
      if (colInizio >= 0) {
        const fromCell = periodFromHeliosDate(row.getCell(colInizio).value);
        if (fromCell) competencePeriod = fromCell;
      }

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

async function loadHeliosContractList(supplierId: string) {
  return prisma.contract.findMany({
    where: {
      supplierId,
      deletedAt: null,
      isHistorical: false,
    },
    select: {
      id: true,
      podPdr: true,
      pod: true,
      pdr: true,
      client: {
        select: {
          type: true,
          firstName: true,
          lastName: true,
          companyName: true,
        },
      },
      recurringMonths: {
        select: { id: true, period: true, status: true, amount: true },
      },
    },
  });
}

type HeliosContractRow = Awaited<ReturnType<typeof loadHeliosContractList>>[number];

async function loadHeliosContractsByPod(): Promise<
  | {
      ok: true;
      byPod: Map<string, HeliosContractRow[]>;
      byName: Map<string, HeliosContractRow[]>;
    }
  | { ok: false; error: string }
> {
  const helios = await prisma.supplier.findFirst({
    where: { name: { equals: "Helios", mode: "insensitive" } },
    select: { id: true },
  });
  if (!helios) {
    return { ok: false, error: "Fornitore Helios non trovato nel CRM" };
  }

  const contracts = await loadHeliosContractList(helios.id);
  const byPod = new Map<string, HeliosContractRow[]>();
  const byName = new Map<string, HeliosContractRow[]>();

  for (const c of contracts) {
    const key = normalizePodKey(c.podPdr || c.pod || c.pdr);
    if (key) {
      const list = byPod.get(key) ?? [];
      list.push(c);
      byPod.set(key, list);
    } else {
      const nameKey = normalizePersonKey(clientDisplayName(c.client));
      if (!nameKey) continue;
      const list = byName.get(nameKey) ?? [];
      list.push(c);
      byName.set(nameKey, list);
    }
  }
  return { ok: true, byPod, byName };
}

function resolveHeliosMatch(
  line: ParsedHeliosLine,
  byPod: Map<string, HeliosContractRow[]>,
  byName: Map<string, HeliosContractRow[]>,
): {
  matches: HeliosContractRow[];
  matchedByName: boolean;
} {
  const podMatches = byPod.get(line.pod) ?? [];
  if (podMatches.length > 0) {
    return { matches: podMatches, matchedByName: false };
  }

  const nameKey = normalizePersonKey(line.intestatario);
  if (!nameKey) return { matches: [], matchedByName: false };

  const nameMatches = byName.get(nameKey) ?? [];
  return { matches: nameMatches, matchedByName: true };
}

function buildPreviewRows(
  lines: ParsedHeliosLine[],
  byPod: Map<
    string,
    Array<{
      id: string;
      client: {
        type: string;
        firstName: string | null;
        lastName: string | null;
        companyName: string | null;
      };
      recurringMonths: Array<{ period: string; status: string }>;
    }>
  >,
  byName: Map<
    string,
    Array<{
      id: string;
      client: {
        type: string;
        firstName: string | null;
        lastName: string | null;
        companyName: string | null;
      };
      recurringMonths: Array<{ period: string; status: string }>;
    }>
  >,
): HeliosImportPreviewRow[] {
  return lines.map((line) => {
    const { matches, matchedByName } = resolveHeliosMatch(
      line,
      byPod as Map<string, HeliosContractRow[]>,
      byName as Map<string, HeliosContractRow[]>,
    );

    if (matches.length === 0) {
      return {
        excelRow: line.excelRow,
        pod: line.pod,
        intestatario: line.intestatario,
        baseAmount: line.baseAmount,
        competencePeriod: line.competencePeriod,
        status: "not_found" as const,
      };
    }
    if (matches.length > 1) {
      const first = matches[0]!;
      return {
        excelRow: line.excelRow,
        pod: line.pod,
        intestatario: line.intestatario,
        baseAmount: line.baseAmount,
        competencePeriod: line.competencePeriod,
        status: "ambiguous" as const,
        contractId: first.id,
        clientName: clientDisplayName(first.client),
      };
    }
    const c = matches[0]!;
    const month = c.recurringMonths.find(
      (m) => m.period === line.competencePeriod,
    );
    const already = month?.status === "PAID";
    return {
      excelRow: line.excelRow,
      pod: line.pod,
      intestatario: line.intestatario,
      baseAmount: line.baseAmount,
      competencePeriod: line.competencePeriod,
      status: already ? ("already_paid" as const) : ("will_pay" as const),
      contractId: c.id,
      clientName: clientDisplayName(c.client),
      willUpdatePod: matchedByName,
    };
  });
}

function summarize(rows: HeliosImportPreviewRow[]) {
  return {
    total: rows.length,
    willPay: rows.filter((r) => r.status === "will_pay").length,
    alreadyPaid: rows.filter((r) => r.status === "already_paid").length,
    notFound: rows.filter((r) => r.status === "not_found").length,
    ambiguous: rows.filter((r) => r.status === "ambiguous").length,
    podsToUpdate: rows.filter((r) => r.willUpdatePod).length,
  };
}

export async function previewHeliosProvvigioniAction(
  formData: FormData,
): Promise<HeliosImportPreviewResult | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!hasPermission(session.role, "commissions.view_all") &&
        !hasPermission(session.role, "commissions.edit_gettone") &&
        !hasPermission(session.role, "commissions.edit_own_gettone")) {
      return { ok: false, error: "Non hai permesso di importare i rendiconti Helios" };
    }

    const loaded = await bufferFromForm(formData);
    if (!loaded.ok) return loaded;

    let competencePeriod = String(formData.get("competencePeriod") ?? "").trim();
    let settledPeriod = String(formData.get("settledPeriod") ?? "").trim();
    if (!isYearMonthPeriod(competencePeriod)) {
      competencePeriod =
        guessCompetenceFromFilename(loaded.fileName) ??
        `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    }
    if (!isYearMonthPeriod(settledPeriod)) settledPeriod = competencePeriod;

    const parsed = await parseHeliosProvvigioniBuffer(
      loaded.buffer,
      competencePeriod,
    );
    if (!parsed.ok) return parsed;

    const map = await loadHeliosContractsByPod();
    if (!map.ok) {
      return { ok: false, error: map.error };
    }

    const rows = buildPreviewRows(parsed.lines, map.byPod, map.byName);
    const competencePeriods = [
      ...new Set(rows.map((r) => r.competencePeriod)),
    ].sort();
    const multiMonth = competencePeriods.length > 1;

    return {
      ok: true,
      competencePeriod: competencePeriods[0] ?? competencePeriod,
      settledPeriod,
      multiMonth,
      competencePeriods,
      fileName: loaded.fileName,
      rows,
      summary: summarize(rows),
    };
  } catch (e) {
    console.error("[previewHeliosProvvigioniAction]", e);
    return {
      ok: false,
      error:
        e instanceof Error
          ? e.message.slice(0, 200)
          : "Anteprima Helios non riuscita",
    };
  }
}

export async function applyHeliosProvvigioniAction(
  formData: FormData,
): Promise<
  | {
      ok: true;
      paid: number;
      skippedPaid: number;
      notFound: number;
      ambiguous: number;
      podsUpdated: number;
      competencePeriod: string;
      settledPeriod: string;
    }
  | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!hasPermission(session.role, "commissions.view_all") &&
        !hasPermission(session.role, "commissions.edit_gettone") &&
        !hasPermission(session.role, "commissions.edit_own_gettone")) {
      return { ok: false, error: "Non hai permesso di importare i rendiconti Helios" };
    }

    const loaded = await bufferFromForm(formData);
    if (!loaded.ok) return loaded;

    let competencePeriod = String(formData.get("competencePeriod") ?? "").trim();
    let settledPeriod = String(formData.get("settledPeriod") ?? "").trim();
    if (!isYearMonthPeriod(competencePeriod)) {
      competencePeriod =
        guessCompetenceFromFilename(loaded.fileName) ??
        `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    }
    if (!isYearMonthPeriod(settledPeriod)) settledPeriod = competencePeriod;

    const parsed = await parseHeliosProvvigioniBuffer(
      loaded.buffer,
      competencePeriod,
    );
    if (!parsed.ok) return parsed;

    const map = await loadHeliosContractsByPod();
    if (!map.ok) return { ok: false, error: map.error };

    const preview = buildPreviewRows(parsed.lines, map.byPod, map.byName);
    const amountByKey = new Map(
      parsed.lines.map((l) => [`${l.pod}|${l.competencePeriod}`, l.baseAmount]),
    );

    let paid = 0;
    let skippedPaid = 0;
    let podsUpdated = 0;
    const podUpdatedIds = new Set<string>();
    const notFound = preview.filter((r) => r.status === "not_found").length;
    const ambiguous = preview.filter((r) => r.status === "ambiguous").length;
    const competencePeriods = [
      ...new Set(preview.map((r) => r.competencePeriod)),
    ].sort();

    for (const row of preview) {
      if (row.willUpdatePod && row.contractId && !podUpdatedIds.has(row.contractId)) {
        await prisma.contract.update({
          where: { id: row.contractId },
          data: {
            podPdr: row.pod,
            pod: row.pod,
          },
        });
        podUpdatedIds.add(row.contractId);
        podsUpdated++;
      }

      if (row.status === "already_paid") {
        skippedPaid++;
        continue;
      }
      if (row.status !== "will_pay" || !row.contractId) continue;

      const rowPeriod = row.competencePeriod;
      const amount =
        amountByKey.get(`${row.pod}|${rowPeriod}`) || null;
      const existing = await prisma.recurringMonth.findUnique({
        where: {
          contractId_period: {
            contractId: row.contractId,
            period: rowPeriod,
          },
        },
      });

      if (existing?.status === "PAID") {
        skippedPaid++;
        continue;
      }

      if (existing) {
        await prisma.recurringMonth.update({
          where: { id: existing.id },
          data: {
            status: "PAID",
            paidAt: new Date(),
            settledPeriod,
            amount: amount ?? existing.amount,
            note: existing.note ?? "Import file Helios",
          },
        });
      } else {
        await prisma.recurringMonth.create({
          data: {
            contractId: row.contractId,
            period: rowPeriod,
            status: "PAID",
            paidAt: new Date(),
            settledPeriod,
            amount,
            note: "Import file Helios",
          },
        });
      }

      const [y, mo] = rowPeriod.split("-").map(Number);
      await prisma.contract.update({
        where: { id: row.contractId },
        data: {
          paymentStatus: "Incassato",
          collectionDate: new Date(y, mo - 1, 1),
          recurrence: "Ricorrente",
        },
      });

      await syncRecurringMonthsForContract(row.contractId).catch(() => undefined);
      paid++;
    }

    await writeAuditLog({
      userId: session.id,
      action: "IMPORT",
      entity: "HeliosProvvigioni",
      entityId: competencePeriods.join(",") || competencePeriod,
      details: {
        fileName: loaded.fileName,
        competencePeriod,
        competencePeriods,
        settledPeriod,
        paid,
        skippedPaid,
        notFound,
        ambiguous,
        podsUpdated,
      },
    });

    revalidatePath("/provvigioni");
    revalidatePath("/archivio");
    revalidatePath("/");
    revalidatePath("/contratti");

    return {
      ok: true,
      paid,
      skippedPaid,
      notFound,
      ambiguous,
      podsUpdated,
      competencePeriod: competencePeriods[0] ?? competencePeriod,
      settledPeriod,
    };
  } catch (e) {
    console.error("[applyHeliosProvvigioniAction]", e);
    return {
      ok: false,
      error:
        e instanceof Error
          ? e.message.slice(0, 200)
          : "Import Helios non riuscito",
    };
  }
}
