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

const AUTO_CLOSED_BEFORE_START = "Esclusa: precedente all'ingresso in fornitura";
const AUTO_CLOSED_AFTER_END = "Esclusa: successiva alla chiusura del contratto";

/**
 * Controllo globale dei limiti temporali delle ricorrenze già presenti.
 * Corregge dati storici senza rigenerare ogni rata di ogni contratto.
 */
export async function reconcileAllRecurringBounds(): Promise<{
  checked: number;
  excluded: number;
}> {
  const contracts = await prisma.contract.findMany({
    where: {
      isHistorical: false,
      deletedAt: null,
      OR: [...recurringMonthlyWhereOr, ...recurringAnnualWhereOr],
    },
    select: {
      id: true,
      insertionDate: true,
      supplyStartDate: true,
      operationType: true,
      status: true,
      statusHistory: {
        where: { toStatus: "CHIUSO" },
        select: { changedAt: true },
        orderBy: { changedAt: "desc" },
        take: 1,
      },
      recurringMonths: {
        where: { status: { not: "CLOSED" } },
        select: { id: true, period: true },
      },
    },
  });

  const invalid: Array<{ id: string; note: string }> = [];
  for (const contract of contracts) {
    const start = toPeriod(
      contract.supplyStartDate ??
        computeSupplyStartDate(contract.insertionDate, contract.operationType),
    );
    const end =
      contract.status === "CHIUSO" && contract.statusHistory[0]
        ? toPeriod(contract.statusHistory[0].changedAt)
        : null;
    for (const installment of contract.recurringMonths) {
      if (installment.period < start) {
        invalid.push({ id: installment.id, note: AUTO_CLOSED_BEFORE_START });
      } else if (end && installment.period > end) {
        invalid.push({ id: installment.id, note: AUTO_CLOSED_AFTER_END });
      }
    }
  }

  // Aggiornamenti puntuali: affidabili anche tramite il proxy DB di produzione.
  for (let offset = 0; offset < invalid.length; offset += 25) {
    await Promise.all(
      invalid.slice(offset, offset + 25).map((row) =>
        prisma.recurringMonth.update({
          where: { id: row.id },
          data: {
            status: "CLOSED",
            paidAt: null,
            settledPeriod: null,
            note: row.note,
          },
        }),
      ),
    );
  }

  return { checked: contracts.length, excluded: invalid.length };
}

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
      statusHistory: {
        where: { toStatus: "CHIUSO" },
        select: { changedAt: true },
        orderBy: { changedAt: "desc" },
        take: 1,
      },
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

  const startDate =
    contract.supplyStartDate ??
    computeSupplyStartDate(contract.insertionDate, contract.operationType);
  const start = toPeriod(startDate);
  const now = toPeriod(new Date());

  // Elimina dai conteggi qualsiasi rata precedente all'effettivo ingresso.
  const beforeSupply = await prisma.recurringMonth.findMany({
    where: { contractId, period: { lt: start } },
    select: { id: true },
  });
  for (const row of beforeSupply) {
    await prisma.recurringMonth.update({
      where: { id: row.id },
      data: {
        status: "CLOSED",
        paidAt: null,
        settledPeriod: null,
        note: AUTO_CLOSED_BEFORE_START,
      },
    });
  }

  if (contract.status === "ANNULLATO" || contract.status === "KO") {
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

  // Per un contratto chiuso, il mese del cambio stato è l'ultima competenza valida.
  const closedPeriod =
    contract.status === "CHIUSO"
      ? toPeriod(contract.statusHistory[0]?.changedAt ?? new Date())
      : null;
  if (closedPeriod) {
    const afterClosure = await prisma.recurringMonth.findMany({
      where: { contractId, period: { gt: closedPeriod } },
      select: { id: true },
    });
    for (const row of afterClosure) {
      await prisma.recurringMonth.update({
        where: { id: row.id },
        data: {
          status: "CLOSED",
          paidAt: null,
          settledPeriod: null,
          note: AUTO_CLOSED_AFTER_END,
        },
      });
    }
  }
  const lastPeriod = closedPeriod && closedPeriod < now ? closedPeriod : now;
  const amount = Number(contract.commission?.expected ?? 0) || null;

  if (isRecurringAnnual(contract.recurrence)) {
    await syncAnnualPeriods(contractId, start, lastPeriod, amount);
    return;
  }

  if (!isRecurringMonthly(contract.recurrence)) return;

  const periods = monthsBetween(start, lastPeriod);
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

  const isAutomaticClosure =
    existing?.status === "CLOSED" &&
    (existing.note === AUTO_CLOSED_BEFORE_START || existing.note === AUTO_CLOSED_AFTER_END);
  if (existing && PRESERVED_STATUSES.has(existing.status) && !isAutomaticClosure) {
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
        settledPeriod: null,
        note: isAutomaticClosure ? null : existing.note,
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

/** Sincronizzazione globale, ottimizzata, di tutte le ricorrenze. */
export async function syncAllRecurringMonths(collaboratorId?: string): Promise<number> {
  const contracts = await prisma.contract.findMany({
    where: {
      isHistorical: false,
      deletedAt: null,
      ...(collaboratorId ? { collaboratorId } : {}),
      OR: [...recurringMonthlyWhereOr, ...recurringAnnualWhereOr],
    },
    select: {
      id: true,
      recurrence: true,
      insertionDate: true,
      supplyStartDate: true,
      operationType: true,
      status: true,
      commission: { select: { expected: true } },
      statusHistory: {
        where: { toStatus: "CHIUSO" },
        select: { changedAt: true },
        orderBy: { changedAt: "desc" },
        take: 1,
      },
      recurringMonths: {
        select: { id: true, period: true, status: true, amount: true, note: true },
      },
    },
  });

  const now = toPeriod(new Date());
  const creates: Array<{
    contractId: string;
    period: string;
    status: string;
    amount: number | null;
  }> = [];
  const updates: Array<{
    id: string;
    status: string;
    amount: number | null;
    clearAutoClosure: boolean;
  }> = [];
  const annualIds: string[] = [];

  for (const contract of contracts) {
    if (isRecurringAnnual(contract.recurrence)) {
      annualIds.push(contract.id);
      continue;
    }
    if (!isRecurringMonthly(contract.recurrence)) continue;
    if (contract.status === "ANNULLATO" || contract.status === "KO") continue;

    const start = toPeriod(
      contract.supplyStartDate ??
        computeSupplyStartDate(contract.insertionDate, contract.operationType),
    );
    const closedPeriod =
      contract.status === "CHIUSO" && contract.statusHistory[0]
        ? toPeriod(contract.statusHistory[0].changedAt)
        : null;
    const lastPeriod = closedPeriod && closedPeriod < now ? closedPeriod : now;
    const amount = Number(contract.commission?.expected ?? 0) || null;
    const existing = new Map(contract.recurringMonths.map((row) => [row.period, row]));

    for (const period of monthsBetween(start, lastPeriod)) {
      const finalStatus = period < now ? "MISSING" : "PENDING";
      const row = existing.get(period);
      if (!row) {
        creates.push({ contractId: contract.id, period, status: finalStatus, amount });
        continue;
      }
      const autoClosed =
        row.status === "CLOSED" &&
        (row.note === AUTO_CLOSED_BEFORE_START || row.note === AUTO_CLOSED_AFTER_END);
      if (PRESERVED_STATUSES.has(row.status) && !autoClosed) continue;
      if (row.status !== finalStatus || (amount != null && row.amount == null) || autoClosed) {
        updates.push({
          id: row.id,
          status: finalStatus,
          amount: amount ?? (row.amount == null ? null : Number(row.amount)),
          clearAutoClosure: autoClosed,
        });
      }
    }
  }

  // Creazioni sequenziali: il proxy DB può rifiutare upsert concorrenti in massa.
  for (const row of creates) {
    try {
      await prisma.recurringMonth.create({ data: row });
    } catch (error) {
      // Un'altra sincronizzazione può averla appena creata: in quel caso è già a posto.
      console.error("sync recurring create", row.contractId, row.period, error);
    }
  }
  for (let offset = 0; offset < updates.length; offset += 25) {
    await Promise.all(
      updates.slice(offset, offset + 25).map((row) =>
        prisma.recurringMonth.update({
          where: { id: row.id },
          data: {
            status: row.status,
            amount: row.amount,
            paidAt: null,
            settledPeriod: null,
            ...(row.clearAutoClosure ? { note: null } : {}),
          },
        }),
      ),
    );
  }

  // Le annuali sono poche: per ciascuna usa l'ultimo incasso + 12 mesi.
  for (let offset = 0; offset < annualIds.length; offset += 8) {
    await Promise.all(
      annualIds
        .slice(offset, offset + 8)
        .map((id) => syncRecurringMonthsForContract(id)),
    );
  }
  console.info("[syncAllRecurringMonths]", {
    contracts: contracts.length,
    monthlyCreated: creates.length,
    monthlyUpdated: updates.length,
    annualChecked: annualIds.length,
  });
  return contracts.length;
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

  const rows = await prisma.recurringMonth.findMany({
    where: {
      status: { in: ["MISSING", "PENDING"] },
      period: periodFilter,
      contract: {
        isHistorical: false,
        deletedAt: null,
        status: { notIn: ["KO", "ANNULLATO", "CHIUSO"] },
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
          insertionDate: true,
          operationType: true,
          supplyStartDate: true,
          status: true,
          statusHistory: {
            where: { toStatus: "CHIUSO" },
            select: { changedAt: true },
            orderBy: { changedAt: "desc" },
            take: 1,
          },
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
    take: 1000,
  });
  return rows.filter((row) => {
    const start = toPeriod(
      row.contract.supplyStartDate ??
        computeSupplyStartDate(
          row.contract.insertionDate,
          row.contract.operationType,
        ),
    );
    if (row.period < start) return false;
    const closedAt =
      row.contract.status === "CHIUSO"
        ? row.contract.statusHistory[0]?.changedAt
        : null;
    return !closedAt || row.period <= toPeriod(closedAt);
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
