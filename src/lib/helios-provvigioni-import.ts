"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { clientDisplayName } from "@/lib/utils";
import { normalizePodKey } from "@/lib/storno-status";
import { syncRecurringMonthsForContract } from "@/lib/recurring-sync";
import {
  parseHeliosProvvigioniBuffer,
  type ParsedHeliosLine,
} from "@/lib/helios-provvigioni-parse";
import {
  guessCompetenceFromFilename,
  isYearMonthPeriod,
  normalizePersonKey,
  type HeliosImportPreviewRow,
  type HeliosImportPreviewResult,
} from "@/lib/helios-provvigioni-shared";

export type {
  HeliosImportPreviewRow,
  HeliosImportPreviewResult,
  HeliosImportRowStatus,
} from "@/lib/helios-provvigioni-shared";

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
      /** Mesi segnati incassati (fornitore), non liquidati al collaboratore */
      collected: number;
      skippedCollected: number;
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

    let collected = 0;
    let skippedCollected = 0;
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
        skippedCollected++;
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
        skippedCollected++;
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
            note: existing.note ?? "Import rendiconto fornitore (Helios)",
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
            note: "Import rendiconto fornitore (Helios)",
          },
        });
      }

      const contract = await prisma.contract.findUnique({
        where: { id: row.contractId },
        select: { status: true },
      });
      const [y, mo] = rowPeriod.split("-").map(Number);
      await prisma.contract.update({
        where: { id: row.contractId },
        data: {
          // Incassato dal fornitore — NON liquidare il collaboratore (Pagato)
          ...(contract?.status === "PROVVIGIONE_LIQUIDATA"
            ? {}
            : { status: "PAGATO_DAL_FORNITORE" }),
          paymentStatus: "Incassato",
          collectionDate: new Date(y, mo - 1, 1),
          recurrence: "M",
        },
      });

      await syncRecurringMonthsForContract(row.contractId).catch(() => undefined);
      collected++;
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
        collected,
        skippedCollected,
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
      collected,
      skippedCollected,
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
