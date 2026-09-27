/**
 * Bonifica rate annuali (R) con competenza negli anni passati (< 2026).
 *
 * - Rate RecurringMonth con period < 2026-01 → LIQUIDATED (ciclo completo).
 * - Gettone/unità contratto R con competenza unità < 2026 → PROVVIGIONE_LIQUIDATA.
 * - Rate/contratti 2026+ lasciati aperti (PENDING / Da incassare, o PAID/LIQUIDATED
 *   se già correttamente impostati — non forzati).
 * - Non tocca Helios mensili (M) né altre ricorrenze non-R.
 *
 * Percorso automatico (sync Provvigioni / cron daily-backup) + apply Admin.
 * Neon HTTP: niente updateMany / createMany / $transaction — loop 1-by-1.
 */
import "server-only";

import { prisma } from "@/lib/prisma";
import { clientDisplayName } from "@/lib/utils";
import { periodLabel } from "@/lib/recurring";
import {
  ANNUAL_PAST_YEARS_APPLY_BATCH,
  ANNUAL_PAST_YEARS_AUTO_MAX_BATCHES,
  ANNUAL_PAST_YEARS_CONTRACT_NOTE,
  ANNUAL_PAST_YEARS_MONTH_NOTE,
  ANNUAL_PAST_YEARS_OPEN_FROM,
  ANNUAL_PAST_YEARS_SCAN_BATCH,
  annualUnitCompetencePeriod,
  isAnnualPastPeriod,
  shouldLiquidateAnnualContractUnit,
  shouldLiquidateAnnualMonth,
  type AnnualPastYearsRow,
} from "@/lib/annual-past-years-shared";

export {
  ANNUAL_PAST_YEARS_APPLY_BATCH,
  ANNUAL_PAST_YEARS_AUTO_MAX_BATCHES,
  ANNUAL_PAST_YEARS_CONTRACT_NOTE,
  ANNUAL_PAST_YEARS_MONTH_NOTE,
  ANNUAL_PAST_YEARS_OPEN_FROM,
  ANNUAL_PAST_YEARS_SCAN_BATCH,
  annualUnitCompetencePeriod,
  isAnnualPastPeriod,
  shouldLiquidateAnnualContractUnit,
  shouldLiquidateAnnualMonth,
  type AnnualPastYearsRow,
};

const ANNUAL_CONTRACT_WHERE = {
  deletedAt: null,
  isHistorical: false,
  recurrenceKind: "R" as const,
};

export type AnnualPastYearsScan = {
  rows: AnnualPastYearsRow[];
  openFrom: string;
  scanned: number;
  nextCursor: string | null;
};

function contractLabel(c: {
  podPdr: string | null;
  pod: string | null;
  pdr: string | null;
  client: {
    type: "PRIVATO" | "AZIENDA";
    companyName: string | null;
    firstName: string | null;
    lastName: string | null;
  };
}): string {
  const name = clientDisplayName(c.client);
  const pod = c.podPdr || c.pod || c.pdr || "";
  return pod ? `${name} · ${pod}` : name;
}

/**
 * Anteprima: rate + gettoni annuali da liquidare (competenze < openFrom).
 * Cursor su id rata; i contratti unità sono aggregati nella stessa pagina
 * solo al primo lotto (cursor null) per evitare doppioni tra pagine.
 */
export async function scanAnnualPastYears(opts?: {
  cursor?: string | null;
  batchSize?: number;
  openFrom?: string;
}): Promise<AnnualPastYearsScan> {
  const openFrom = opts?.openFrom ?? ANNUAL_PAST_YEARS_OPEN_FROM;
  const batchSize = Math.min(
    Math.max(Number(opts?.batchSize) || ANNUAL_PAST_YEARS_SCAN_BATCH, 10),
    ANNUAL_PAST_YEARS_SCAN_BATCH,
  );
  const cursor = opts?.cursor?.trim() || null;

  const months = await prisma.recurringMonth.findMany({
    where: {
      period: { lt: openFrom },
      status: { not: "LIQUIDATED" },
      ...(cursor ? { id: { gt: cursor } } : {}),
      contract: ANNUAL_CONTRACT_WHERE,
    },
    select: {
      id: true,
      period: true,
      status: true,
      amount: true,
      contract: {
        select: {
          id: true,
          podPdr: true,
          pod: true,
          pdr: true,
          collaborator: { select: { name: true } },
          supplier: { select: { name: true } },
          client: {
            select: {
              type: true,
              companyName: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      },
    },
    orderBy: { id: "asc" },
    take: batchSize + 1,
  });

  const page = months.slice(0, batchSize);
  const nextCursor =
    months.length > batchSize ? (page[page.length - 1]?.id ?? null) : null;

  const rows: AnnualPastYearsRow[] = [];
  for (const m of page) {
    if (!shouldLiquidateAnnualMonth({ period: m.period, status: m.status })) {
      continue;
    }
    rows.push({
      id: `month:${m.id}`,
      kind: "month",
      contractId: m.contract.id,
      contractLabel: contractLabel(m.contract),
      collaboratorName: m.contract.collaborator?.name ?? "—",
      supplierName: m.contract.supplier.name,
      period: m.period,
      periodLabel: periodLabel(m.period),
      status: m.status,
      amount: m.amount != null ? Number(m.amount) : null,
    });
  }

  // Contratti unità (gettone prima rata senza RecurringMonth, o ancora aperti).
  if (!cursor) {
    const contracts = await prisma.contract.findMany({
      where: {
        ...ANNUAL_CONTRACT_WHERE,
        status: {
          notIn: ["PROVVIGIONE_LIQUIDATA", "KO", "ANNULLATO", "STORNATO"],
        },
      },
      select: {
        id: true,
        status: true,
        podPdr: true,
        pod: true,
        pdr: true,
        supplyStartDate: true,
        collectionDate: true,
        insertionDate: true,
        commission: { select: { expected: true } },
        collaborator: { select: { name: true } },
        supplier: { select: { name: true } },
        client: {
          select: {
            type: true,
            companyName: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { id: "asc" },
      take: 2000,
    });

    for (const c of contracts) {
      const unitPeriod = annualUnitCompetencePeriod(
        c.supplyStartDate,
        c.collectionDate,
        c.insertionDate,
      );
      if (
        !shouldLiquidateAnnualContractUnit({
          status: c.status,
          unitPeriod,
        })
      ) {
        continue;
      }
      rows.push({
        id: `contract:${c.id}`,
        kind: "contract",
        contractId: c.id,
        contractLabel: contractLabel(c),
        collaboratorName: c.collaborator?.name ?? "—",
        supplierName: c.supplier.name,
        period: unitPeriod!,
        periodLabel: periodLabel(unitPeriod!),
        status: c.status,
        amount:
          c.commission?.expected != null ? Number(c.commission.expected) : null,
      });
    }
  }

  return {
    rows,
    openFrom,
    scanned: rows.length,
    nextCursor,
  };
}

export type AnnualPastYearsApplyResult = {
  monthsLiquidated: number;
  contractsLiquidated: number;
  skipped: number;
  openKept: number;
  monthIds: string[];
  contractIds: string[];
  openFrom: string;
};

async function liquidateOneMonth(monthId: string): Promise<"done" | "skip"> {
  const m = await prisma.recurringMonth.findUnique({
    where: { id: monthId },
    select: {
      id: true,
      period: true,
      status: true,
      amount: true,
      paidAt: true,
      settledPeriod: true,
      note: true,
      contractId: true,
      contract: {
        select: {
          recurrenceKind: true,
          deletedAt: true,
          isHistorical: true,
          commission: { select: { id: true, paid: true, received: true } },
        },
      },
    },
  });
  if (!m) return "skip";
  if (m.contract.deletedAt || m.contract.isHistorical) return "skip";
  if (m.contract.recurrenceKind !== "R") return "skip";
  if (!shouldLiquidateAnnualMonth({ period: m.period, status: m.status })) {
    return "skip";
  }

  await prisma.recurringMonth.update({
    where: { id: m.id },
    data: {
      status: "LIQUIDATED",
      paidAt: m.paidAt ?? new Date(),
      settledPeriod: m.settledPeriod ?? m.period,
      note:
        m.note === ANNUAL_PAST_YEARS_MONTH_NOTE
          ? m.note
          : ANNUAL_PAST_YEARS_MONTH_NOTE,
    },
  });

  const commission = m.contract.commission;
  if (commission && m.status !== "LIQUIDATED") {
    const amount = Number(m.amount ?? 0) || 0;
    if (amount > 0) {
      const paid = Number(commission.paid ?? 0) || 0;
      const received = Number(commission.received ?? 0) || 0;
      await prisma.commission.update({
        where: { id: commission.id },
        data: {
          paid: paid + amount,
          received: Math.max(received, paid + amount),
        },
      });
    }
  }

  return "done";
}

async function liquidateOneContract(
  contractId: string,
  changedById: string | null,
): Promise<"done" | "skip"> {
  const c = await prisma.contract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      status: true,
      deletedAt: true,
      isHistorical: true,
      recurrenceKind: true,
      supplyStartDate: true,
      collectionDate: true,
      insertionDate: true,
      commission: { select: { id: true, expected: true, paid: true, received: true } },
    },
  });
  if (!c || c.deletedAt || c.isHistorical) return "skip";
  if (c.recurrenceKind !== "R") return "skip";

  const unitPeriod = annualUnitCompetencePeriod(
    c.supplyStartDate,
    c.collectionDate,
    c.insertionDate,
  );
  if (!shouldLiquidateAnnualContractUnit({ status: c.status, unitPeriod })) {
    return "skip";
  }

  const collectionDate =
    c.collectionDate ??
    c.supplyStartDate ??
    c.insertionDate ??
    (unitPeriod ? new Date(`${unitPeriod}-01T12:00:00.000Z`) : new Date());

  const commission = c.commission;
  if (commission) {
    const expected = Number(commission.expected ?? 0) || 0;
    const paid = Number(commission.paid ?? 0) || 0;
    const received = Number(commission.received ?? 0) || 0;
    const targetReceived = Math.max(received, expected);
    const targetPaid = Math.max(paid, targetReceived);
    if (targetPaid !== paid || targetReceived !== received) {
      await prisma.commission.update({
        where: { id: commission.id },
        data: { paid: targetPaid, received: targetReceived },
      });
    }
  }

  await prisma.contract.update({
    where: { id: c.id },
    data: {
      status: "PROVVIGIONE_LIQUIDATA",
      paymentStatus: "Pagato",
      collectionDate,
    },
  });

  const actorId =
    changedById ??
    (
      await prisma.user.findFirst({
        where: { role: "ADMIN", active: true },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      })
    )?.id;

  if (actorId) {
    await prisma.contractStatusHistory.create({
      data: {
        contractId: c.id,
        toStatus: "PROVVIGIONE_LIQUIDATA",
        changedById: actorId,
        note: ANNUAL_PAST_YEARS_CONTRACT_NOTE,
      },
    });
  }

  return "done";
}

/**
 * Applica la liquidazione agli id selezionati (`month:…` / `contract:…` o id grezzi rata).
 */
export async function applyAnnualPastYearsCleanup(opts: {
  targetIds: string[];
  changedById?: string | null;
}): Promise<AnnualPastYearsApplyResult> {
  const openFrom = ANNUAL_PAST_YEARS_OPEN_FROM;
  let monthsLiquidated = 0;
  let contractsLiquidated = 0;
  let skipped = 0;
  const monthIds: string[] = [];
  const contractIds: string[] = [];
  const actorId = opts.changedById ?? null;

  const monthRaw: string[] = [];
  const contractRaw: string[] = [];
  for (const raw of opts.targetIds) {
    const id = String(raw ?? "").trim();
    if (!id) continue;
    if (id.startsWith("month:")) monthRaw.push(id.slice("month:".length));
    else if (id.startsWith("contract:")) contractRaw.push(id.slice("contract:".length));
    else monthRaw.push(id); // id rata grezzo
  }

  for (const id of [...new Set(monthRaw)]) {
    const outcome = await liquidateOneMonth(id);
    if (outcome === "done") {
      monthsLiquidated += 1;
      monthIds.push(id);
    } else {
      skipped += 1;
    }
  }

  for (const id of [...new Set(contractRaw)]) {
    const outcome = await liquidateOneContract(id, actorId);
    if (outcome === "done") {
      contractsLiquidated += 1;
      contractIds.push(id);
    } else {
      skipped += 1;
    }
  }

  const openKept = await countAnnualOpenKept(openFrom);

  return {
    monthsLiquidated,
    contractsLiquidated,
    skipped,
    openKept,
    monthIds,
    contractIds,
    openFrom,
  };
}

/** Conteggio rate annuali 2026+ ancora aperte (PENDING/MISSING/PAID). */
export async function countAnnualOpenKept(
  openFrom: string = ANNUAL_PAST_YEARS_OPEN_FROM,
): Promise<number> {
  return prisma.recurringMonth.count({
    where: {
      period: { gte: openFrom },
      status: { in: ["PENDING", "MISSING", "PAID", "ERROR_UNPAID"] },
      contract: ANNUAL_CONTRACT_WHERE,
    },
  });
}

/** Conteggio residuali ancora da liquidare (rate + stima unità). */
export async function countAnnualPastPending(
  openFrom: string = ANNUAL_PAST_YEARS_OPEN_FROM,
): Promise<{ months: number; contractsApprox: number }> {
  const months = await prisma.recurringMonth.count({
    where: {
      period: { lt: openFrom },
      status: { not: "LIQUIDATED" },
      contract: ANNUAL_CONTRACT_WHERE,
    },
  });
  return { months, contractsApprox: -1 };
}

export type AnnualPastYearsAutoResult = AnnualPastYearsApplyResult & {
  batches: number;
  done: boolean;
};

/**
 * Pass automatico (sync Provvigioni / cron): liquida fino a
 * `ANNUAL_PAST_YEARS_AUTO_MAX_BATCHES` lotti. Idempotente; non tocca ≥ 2026.
 */
export async function runAnnualPastYearsCleanupAuto(opts?: {
  maxBatches?: number;
  openFrom?: string;
  changedById?: string | null;
}): Promise<AnnualPastYearsAutoResult> {
  const openFrom = opts?.openFrom ?? ANNUAL_PAST_YEARS_OPEN_FROM;
  const maxBatches = Math.min(
    Math.max(Number(opts?.maxBatches) || ANNUAL_PAST_YEARS_AUTO_MAX_BATCHES, 1),
    ANNUAL_PAST_YEARS_AUTO_MAX_BATCHES,
  );
  const actorId = opts?.changedById ?? null;

  let monthsLiquidated = 0;
  let contractsLiquidated = 0;
  let skipped = 0;
  const monthIds: string[] = [];
  const contractIds: string[] = [];
  let batches = 0;
  let done = true;

  for (let i = 0; i < maxBatches; i++) {
    const pendingMonths = await prisma.recurringMonth.findMany({
      where: {
        period: { lt: openFrom },
        status: { not: "LIQUIDATED" },
        contract: ANNUAL_CONTRACT_WHERE,
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: ANNUAL_PAST_YEARS_APPLY_BATCH,
    });

    const targetIds = pendingMonths.map((r) => `month:${r.id}`);

    // Unità contratto: solo al primo batch, in pezzi.
    if (i === 0) {
      const contracts = await prisma.contract.findMany({
        where: {
          ...ANNUAL_CONTRACT_WHERE,
          status: {
            notIn: ["PROVVIGIONE_LIQUIDATA", "KO", "ANNULLATO", "STORNATO"],
          },
        },
        select: {
          id: true,
          status: true,
          supplyStartDate: true,
          collectionDate: true,
          insertionDate: true,
        },
        orderBy: { id: "asc" },
        take: ANNUAL_PAST_YEARS_APPLY_BATCH,
      });
      for (const c of contracts) {
        const unitPeriod = annualUnitCompetencePeriod(
          c.supplyStartDate,
          c.collectionDate,
          c.insertionDate,
        );
        if (
          shouldLiquidateAnnualContractUnit({
            status: c.status,
            unitPeriod,
          })
        ) {
          targetIds.push(`contract:${c.id}`);
        }
      }
    }

    if (targetIds.length === 0) {
      done = true;
      break;
    }

    batches += 1;
    const result = await applyAnnualPastYearsCleanup({
      targetIds,
      changedById: actorId,
    });
    monthsLiquidated += result.monthsLiquidated;
    contractsLiquidated += result.contractsLiquidated;
    skipped += result.skipped;
    monthIds.push(...result.monthIds);
    contractIds.push(...result.contractIds);

    if (pendingMonths.length < ANNUAL_PAST_YEARS_APPLY_BATCH) {
      done = true;
      break;
    }
    done = false;
  }

  const openKept = await countAnnualOpenKept(openFrom);

  if (monthsLiquidated + contractsLiquidated > 0) {
    console.info("[annual-past-years-auto]", {
      monthsLiquidated,
      contractsLiquidated,
      skipped,
      openKept,
      batches,
      done,
      openFrom,
    });
  }

  return {
    monthsLiquidated,
    contractsLiquidated,
    skipped,
    openKept,
    monthIds,
    contractIds,
    openFrom,
    batches,
    done,
  };
}

/** Sanity: verifica che una competenza 2026 non venga mai selezionata. */
export function assertOpenPeriodNotSelected(
  period: string,
  openFrom: string = ANNUAL_PAST_YEARS_OPEN_FROM,
): boolean {
  return !isAnnualPastPeriod(period, openFrom);
}
