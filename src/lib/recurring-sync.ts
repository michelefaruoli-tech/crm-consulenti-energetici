import { prisma } from "@/lib/prisma";
import {
  addMonths,
  isRecurring,
  isRecurringAnnual,
  isRecurringMonthly,
  monthsBetween,
  normalizeRecurrence,
  toPeriod,
} from "@/lib/recurring";
import { computeSupplyStartDate } from "@/lib/supply-dates";
import {
  recurringAnnualWhereOr,
  recurringMonthlyWhereOr,
} from "@/lib/provvigioni-filters";

const PRESERVED_STATUSES = new Set([
  "CLOSED",
  "ERROR_UNPAID",
  "PAID",
  "LIQUIDATED",
]);

/**
 * Per contratti ricorrenti mensili (M): genera mesi da inizio fornitura → oggi.
 * Per contratti ricorrenti annuali (R): genera solo le scadenze a +12 mesi
 * dall’ultimo pagamento (o dall’ingresso se mai pagato).
 *
 * Stati PAID / LIQUIDATED / CLOSED / ERROR_UNPAID non vengono sovrascritti.
 */
export async function syncRecurringMonthsForContract(contractId: string): Promise<void> {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      recurrence: true,
      insertionDate: true,
      supplyStartDate: true,
      operationType: true,
      collectionDate: true,
      status: true,
      commission: { select: { expected: true } },
    },
  });
  if (!contract) return;

  const normalized = normalizeRecurrence(contract.recurrence);
  if (contract.recurrence?.trim() !== normalized) {
    await prisma.contract.update({
      where: { id: contractId },
      data: { recurrence: normalized },
    });
    contract.recurrence = normalized;
  }

  if (!isRecurring(contract.recurrence)) return;

  if (
    contract.status === "CHIUSO" ||
    contract.status === "ANNULLATO" ||
    contract.status === "KO"
  ) {
    const open = await prisma.recurringMonth.findMany({
      where: { contractId, status: { in: ["PENDING", "MISSING"] } },
      select: { id: true },
    });
    for (const row of open) {
      await prisma.recurringMonth.update({
        where: { id: row.id },
        data: { status: "CLOSED" },
      });
    }
    return;
  }

  const startDate =
    contract.supplyStartDate ??
    computeSupplyStartDate(contract.insertionDate, contract.operationType);
  const start = toPeriod(startDate);
  const now = toPeriod(new Date());
  const amount = Number(contract.commission?.expected ?? 0) || null;

  if (isRecurringAnnual(contract.recurrence)) {
    await syncAnnualPeriods(contractId, start, now, amount);
    return;
  }

  if (!isRecurringMonthly(contract.recurrence)) return;

  const periods = monthsBetween(start, now);
  for (const period of periods) {
    await upsertMonthStatus(contractId, period, now, amount);
  }
}

async function syncAnnualPeriods(
  contractId: string,
  supplyStart: string,
  now: string,
  amount: number | null,
): Promise<void> {
  const paidRows = await prisma.recurringMonth.findMany({
    where: {
      contractId,
      status: { in: ["PAID", "LIQUIDATED"] },
    },
    select: { period: true },
    orderBy: { period: "desc" },
  });

  // Baseline: ultimo pagamento ricevuto, altrimenti ingresso fornitura
  // Prima rata dovuta = ingresso + 12 mesi
  let nextDue =
    paidRows.length > 0
      ? addMonths(paidRows[0]!.period, 12)
      : addMonths(supplyStart, 12);

  // Genera tutte le scadenze annuali già maturate (max 10 anni)
  for (let i = 0; i < 10; i++) {
    if (nextDue > now) break;
    // Scadenza annuale già maturata (anche nel mese corrente) → da incassare
    await upsertMonthStatus(contractId, nextDue, now, amount, { treatCurrentAsMissing: true });
    nextDue = addMonths(nextDue, 12);
  }
}

async function upsertMonthStatus(
  contractId: string,
  period: string,
  now: string,
  amount: number | null,
  opts?: { treatCurrentAsMissing?: boolean },
): Promise<void> {
  const existing = await prisma.recurringMonth.findUnique({
    where: { contractId_period: { contractId, period } },
  });

  if (existing && PRESERVED_STATUSES.has(existing.status)) {
    if (amount != null && existing.amount == null) {
      await prisma.recurringMonth.update({
        where: { id: existing.id },
        data: { amount },
      });
    }
    return;
  }

  const finalStatus =
    period < now || (opts?.treatCurrentAsMissing && period <= now)
      ? "MISSING"
      : "PENDING";

  if (existing) {
    await prisma.recurringMonth.update({
      where: { id: existing.id },
      data: {
        status: finalStatus,
        amount: amount ?? existing.amount,
        paidAt: null,
      },
    });
  } else {
    await prisma.recurringMonth.create({
      data: {
        contractId,
        period,
        status: finalStatus,
        amount,
        paidAt: null,
      },
    });
  }
}

/** Normalizza etichette e sync mesi per ricorrenti (o un collaboratore). */
export async function syncAllRecurringMonths(collaboratorId?: string): Promise<number> {
  const contracts = await prisma.contract.findMany({
    where: {
      isHistorical: false,
      deletedAt: null,
      ...(collaboratorId ? { collaboratorId } : {}),
      OR: [...recurringMonthlyWhereOr, ...recurringAnnualWhereOr],
    },
    select: { id: true, recurrence: true },
  });

  const maybeR = await prisma.contract.findMany({
    where: {
      isHistorical: false,
      deletedAt: null,
      ...(collaboratorId ? { collaboratorId } : {}),
      recurrence: { not: null },
      id: { notIn: contracts.map((c) => c.id) },
    },
    select: { id: true, recurrence: true },
    take: 2000,
  });
  const extra = maybeR.filter((c) => isRecurring(c.recurrence));
  const all = [...contracts, ...extra];
  const seen = new Set<string>();
  const MAX_PER_RUN = 12;

  for (const c of all) {
    if (seen.size >= MAX_PER_RUN) break;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    await syncRecurringMonthsForContract(c.id);
  }
  return seen.size;
}

export async function getMissingRecurringAlerts(
  collaboratorId?: string,
  kind: "monthly" | "annual" | "all" = "monthly",
) {
  const recurrenceFilter =
    kind === "monthly"
      ? { OR: recurringMonthlyWhereOr }
      : kind === "annual"
        ? { OR: recurringAnnualWhereOr }
        : { OR: [...recurringMonthlyWhereOr, ...recurringAnnualWhereOr] };

  const now = toPeriod(new Date());
  // Solo mesi che DOVEVANO già essere incassati (non il mese corrente in attesa)
  // Annuali: anche il mese di scadenza corrente conta come dovuto
  const periodFilter =
    kind === "annual" ? { lte: now } : { lt: now };

  return prisma.recurringMonth.findMany({
    where: {
      status: "MISSING",
      period: periodFilter,
      contract: {
        isHistorical: false,
        deletedAt: null,
        ...(collaboratorId ? { collaboratorId } : {}),
        ...recurrenceFilter,
      },
    },
    include: {
      contract: {
        select: {
          id: true,
          podPdr: true,
          recurrence: true,
          supplyStartDate: true,
          collectionDate: true,
          client: {
            select: {
              type: true,
              firstName: true,
              lastName: true,
              companyName: true,
            },
          },
          supplier: { select: { name: true } },
          collaborator: { select: { name: true } },
        },
      },
    },
    orderBy: [{ period: "asc" }],
    take: 120,
  });
}

/** Mesi già incassati dal fornitore ma non ancora liquidati al collaboratore. */
export async function getPaidToLiquidateAlerts(
  collaboratorId?: string,
  kind: "monthly" | "annual" | "all" = "monthly",
) {
  const recurrenceFilter =
    kind === "monthly"
      ? { OR: recurringMonthlyWhereOr }
      : kind === "annual"
        ? { OR: recurringAnnualWhereOr }
        : { OR: [...recurringMonthlyWhereOr, ...recurringAnnualWhereOr] };

  return prisma.recurringMonth.findMany({
    where: {
      status: "PAID",
      contract: {
        isHistorical: false,
        deletedAt: null,
        ...(collaboratorId ? { collaboratorId } : {}),
        ...recurrenceFilter,
      },
    },
    include: {
      contract: {
        select: {
          id: true,
          podPdr: true,
          recurrence: true,
          client: {
            select: {
              type: true,
              firstName: true,
              lastName: true,
              companyName: true,
            },
          },
          supplier: { select: { name: true } },
          collaborator: { select: { name: true } },
        },
      },
    },
    orderBy: [{ settledPeriod: "desc" }, { period: "asc" }],
    take: 80,
  });
}

/** Helios: mesi in cui il POD non compare più nei rendiconti successivi. */
export async function getHeliosAbsentAlerts(collaboratorId?: string) {
  return prisma.recurringMonth.findMany({
    where: {
      status: "ERROR_UNPAID",
      note: { contains: "ASSENTE_RENDICONTO" },
      contract: {
        isHistorical: false,
        deletedAt: null,
        supplier: { name: { equals: "Helios", mode: "insensitive" } },
        ...(collaboratorId ? { collaboratorId } : {}),
      },
    },
    select: {
      id: true,
      period: true,
      note: true,
      contractId: true,
      contract: {
        select: {
          podPdr: true,
          collaborator: { select: { name: true } },
          client: {
            select: {
              type: true,
              firstName: true,
              lastName: true,
              companyName: true,
            },
          },
        },
      },
    },
    orderBy: [{ period: "asc" }],
    take: 80,
  });
}

/** Mesi pagati in un certo rendiconto (es. bonifico di luglio). Incl. LIQUIDATED. */
export async function getSettledRecurringForPeriod(
  settledPeriod: string,
  collaboratorId?: string,
) {
  return prisma.recurringMonth.findMany({
    where: {
      status: { in: ["PAID", "LIQUIDATED"] },
      settledPeriod,
      contract: {
        isHistorical: false,
        deletedAt: null,
        ...(collaboratorId ? { collaboratorId } : {}),
      },
    },
    include: {
      contract: {
        select: {
          id: true,
          podPdr: true,
          collaboratorId: true,
          collaborator: { select: { id: true, name: true } },
          client: {
            select: {
              type: true,
              firstName: true,
              lastName: true,
              companyName: true,
            },
          },
          supplier: { select: { name: true } },
        },
      },
    },
    orderBy: [{ period: "asc" }],
  });
}
