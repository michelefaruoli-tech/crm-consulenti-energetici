import { prisma } from "@/lib/prisma";
import {
  addMonths,
  isRecurring,
  isRecurringAnnual,
  isRecurringMonthly,
  monthsBetween,
  normalizeRecurrence,
  recurrenceWriteData,
  toPeriod,
} from "@/lib/recurring";
import {
  isDisposableRecurringMonth,
  isPeriodInRecurringWindow,
  lastGeneratedPeriod,
  OUT_OF_WINDOW_REASONS,
  outOfWindowReason,
  recurringWindow,
  type RecurringWindow,
} from "@/lib/recurring-window";
import { recurringGenerationLagMonths, isHeliosSupplier } from "@/lib/helios-contract-rules";
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
const AUTO_CLOSED_HELIOS_LAG =
  "Esclusa: Helios non ha ancora pagato questa competenza (lag 2 mesi)";

type OutOfWindowMonthRow = {
  id: string;
  period: string;
  status: string;
  paidAt: Date | null;
  settledPeriod: string | null;
  note?: string | null;
};

function autoClosureNote(window: RecurringWindow, period: string): string {
  const reason = outOfWindowReason(window, period);
  if (reason === OUT_OF_WINDOW_REASONS.beforeStart) return AUTO_CLOSED_BEFORE_START;
  if (reason === OUT_OF_WINDOW_REASONS.afterEnd) return AUTO_CLOSED_AFTER_END;
  return "Esclusa: fuori intervallo di fornitura";
}

function isAutoClosedOutOfWindow(row: OutOfWindowMonthRow): boolean {
  return (
    row.status === "CLOSED" &&
    (row.note === AUTO_CLOSED_BEFORE_START ||
      row.note === AUTO_CLOSED_AFTER_END ||
      row.note === AUTO_CLOSED_HELIOS_LAG)
  );
}

/**
 * Segnala le rate fuori intervallo senza valore economico chiudendole con nota
 * automatica. La rimozione fisica resta solo al pulsante di bonifica (Backup).
 */
async function closeDisposableOutOfWindowMonths(
  rows: OutOfWindowMonthRow[],
  window: RecurringWindow,
): Promise<{ closed: number; manualReview: number }> {
  const toClose: Array<{ id: string; note: string }> = [];
  let manualReview = 0;

  for (const row of rows) {
    if (isPeriodInRecurringWindow(window, row.period)) continue;
    if (!isDisposableRecurringMonth(row)) {
      manualReview++;
      continue;
    }
    if (isAutoClosedOutOfWindow(row)) continue;
    toClose.push({ id: row.id, note: autoClosureNote(window, row.period) });
  }

  for (let offset = 0; offset < toClose.length; offset += 25) {
    await Promise.all(
      toClose.slice(offset, offset + 25).map((row) =>
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

  return { closed: toClose.length, manualReview };
}

/**
 * Il mese di competenza è ammesso per questo contratto?
 * Guardia da usare prima di creare una rata da azioni manuali o import.
 */
export async function isPeriodAllowedForContract(
  contractId: string,
  period: string,
): Promise<boolean> {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: {
      insertionDate: true,
      supplyStartDate: true,
      operationType: true,
      status: true,
      expiryDate: true,
      statusHistory: {
        where: { toStatus: "CHIUSO" },
        select: { changedAt: true },
        orderBy: { changedAt: "desc" },
        take: 1,
      },
    },
  });
  if (!contract) return false;
  return isPeriodInRecurringWindow(recurringWindow(contract), period);
}

/**
 * Chiude le rate del contratto fuori dall'intervallo di competenza.
 * Le rate incassate / pagate / segnalate a mano non vengono toccate:
 * finiscono nel conteggio `manualReview` e restano visibili.
 */
async function purgeOutOfWindowMonths(
  contractId: string,
  window: RecurringWindow,
): Promise<{ closed: number; manualReview: number }> {
  const rows = await prisma.recurringMonth.findMany({
    where: {
      contractId,
      OR: [
        { period: { lt: window.start } },
        ...(window.end ? [{ period: { gt: window.end } }] : []),
      ],
    },
    select: {
      id: true,
      period: true,
      status: true,
      paidAt: true,
      settledPeriod: true,
      note: true,
    },
  });

  return closeDisposableOutOfWindowMonths(rows, window);
}

async function closeDisposableHeliosLagMonths(
  rows: OutOfWindowMonthRow[],
  lastPeriod: string,
): Promise<number> {
  const toClose: Array<{ id: string }> = [];
  for (const row of rows) {
    if (row.period <= lastPeriod) continue;
    if (!isDisposableRecurringMonth(row)) continue;
    if (row.status === "CLOSED" && row.note === AUTO_CLOSED_HELIOS_LAG) continue;
    toClose.push({ id: row.id });
  }
  for (let offset = 0; offset < toClose.length; offset += 25) {
    await Promise.all(
      toClose.slice(offset, offset + 25).map((row) =>
        prisma.recurringMonth.update({
          where: { id: row.id },
          data: {
            status: "CLOSED",
            paidAt: null,
            settledPeriod: null,
            note: AUTO_CLOSED_HELIOS_LAG,
          },
        }),
      ),
    );
  }
  return toClose.length;
}

/**
 * Controllo globale dei limiti temporali delle ricorrenze già presenti.
 * Corregge dati storici senza rigenerare ogni rata di ogni contratto.
 *
 * Le rate fuori intervallo senza valore economico vengono chiuse con nota
 * automatica; quelle incassate/pagate/segnalate restano e sono contate in
 * `manualReview`. La rimozione fisica è solo dal pulsante di bonifica.
 */
export async function reconcileAllRecurringBounds(): Promise<{
  checked: number;
  excluded: number;
  manualReview: number;
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
      expiryDate: true,
      statusHistory: {
        where: { toStatus: "CHIUSO" },
        select: { changedAt: true },
        orderBy: { changedAt: "desc" },
        take: 1,
      },
      recurringMonths: {
        select: {
          id: true,
          period: true,
          status: true,
          paidAt: true,
          settledPeriod: true,
          note: true,
        },
      },
    },
  });

  let excluded = 0;
  let manualReview = 0;
  for (const contract of contracts) {
    const window = recurringWindow(contract);
    const result = await closeDisposableOutOfWindowMonths(
      contract.recurringMonths,
      window,
    );
    excluded += result.closed;
    manualReview += result.manualReview;
  }

  return {
    checked: contracts.length,
    excluded,
    manualReview,
  };
}

/**
 * Per contratti ricorrenti mensili (M): genera i mesi dell'intervallo di
 * fornitura (mese di ingresso incluso) fino a oggi o al mese di chiusura.
 * Per contratti ricorrenti annuali (R): genera solo le scadenze a +12 mesi
 * dall’ultimo pagamento (o dall’ingresso se mai pagato).
 *
 * Le rate fuori intervallo vengono chiuse (vedi `purgeOutOfWindowMonths`).
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
      expiryDate: true,
      statusHistory: {
        where: { toStatus: "CHIUSO" },
        select: { changedAt: true },
        orderBy: { changedAt: "desc" },
        take: 1,
      },
      commission: { select: { expected: true } },
      supplier: { select: { name: true } },
    },
  });
  if (!contract) return;

  const normalized = normalizeRecurrence(contract.recurrence);
  if (contract.recurrence?.trim() !== normalized) {
    await prisma.contract.update({
      where: { id: contractId },
      data: recurrenceWriteData(normalized),
    });
    contract.recurrence = normalized;
  }

  if (!isRecurring(contract.recurrence)) return;

  const nowDate = new Date();
  const now = toPeriod(nowDate);
  const window = recurringWindow(contract, nowDate);
  const start = window.start;

  // Rate fuori intervallo (prima dell'ingresso o dopo la chiusura): via.
  // Restano solo quelle con valore economico, da decidere a mano.
  await purgeOutOfWindowMonths(contractId, window);

  // Pratica fallita: chiudi mesi aperti e non generarne di nuovi.
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

  const lastPeriod = lastGeneratedPeriod(
    window,
    nowDate,
    recurringGenerationLagMonths(contract.supplier?.name),
  );

  const amount = Number(contract.commission?.expected ?? 0) || null;

  if (isRecurringAnnual(contract.recurrence)) {
    if (contract.status !== "CHIUSO") {
      await syncAnnualPeriods(contractId, start, lastPeriod, amount);
    }
    return;
  }

  if (!isRecurringMonthly(contract.recurrence)) return;

  if (start <= lastPeriod) {
    const periods = monthsBetween(start, lastPeriod);
    for (const period of periods) {
      await upsertMonthStatus(contractId, period, now, amount);
    }
  }

  if (isHeliosSupplier(contract.supplier?.name)) {
    const extra = await prisma.recurringMonth.findMany({
      where: { contractId, period: { gt: lastPeriod } },
      select: {
        id: true,
        period: true,
        status: true,
        paidAt: true,
        settledPeriod: true,
        note: true,
      },
    });
    await closeDisposableHeliosLagMonths(extra, lastPeriod);
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
    (existing.note === AUTO_CLOSED_BEFORE_START ||
      existing.note === AUTO_CLOSED_AFTER_END ||
      existing.note === AUTO_CLOSED_HELIOS_LAG);
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
      expiryDate: true,
      commission: { select: { expected: true } },
      supplier: { select: { name: true } },
      statusHistory: {
        where: { toStatus: "CHIUSO" },
        select: { changedAt: true },
        orderBy: { changedAt: "desc" },
        take: 1,
      },
      recurringMonths: {
        select: {
          id: true,
          period: true,
          status: true,
          amount: true,
          note: true,
          paidAt: true,
          settledPeriod: true,
        },
      },
    },
  });

  const nowDate = new Date();
  const now = toPeriod(nowDate);
  const outOfWindowClosures: Array<{ id: string; note: string }> = [];
  const heliosLagClosures: Array<{ id: string }> = [];
  let manualReview = 0;
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
    // Le rate fuori intervallo vanno chiuse anche per annuali / pratiche KO.
    const window = recurringWindow(contract, nowDate);
    for (const row of contract.recurringMonths) {
      if (isPeriodInRecurringWindow(window, row.period)) continue;
      if (!isDisposableRecurringMonth(row)) {
        manualReview++;
        continue;
      }
      if (isAutoClosedOutOfWindow(row)) continue;
      outOfWindowClosures.push({
        id: row.id,
        note: autoClosureNote(window, row.period),
      });
    }

    if (isRecurringAnnual(contract.recurrence)) {
      annualIds.push(contract.id);
      continue;
    }
    if (!isRecurringMonthly(contract.recurrence)) continue;
    if (contract.status === "ANNULLATO" || contract.status === "KO") continue;

    const start = window.start;
    const lastPeriod = lastGeneratedPeriod(
      window,
      nowDate,
      recurringGenerationLagMonths(contract.supplier?.name),
    );
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
        (row.note === AUTO_CLOSED_BEFORE_START ||
          row.note === AUTO_CLOSED_AFTER_END ||
          row.note === AUTO_CLOSED_HELIOS_LAG);
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

    if (isHeliosSupplier(contract.supplier?.name)) {
      for (const row of contract.recurringMonths) {
        if (row.period <= lastPeriod) continue;
        if (!isDisposableRecurringMonth(row)) continue;
        if (row.status === "CLOSED" && row.note === AUTO_CLOSED_HELIOS_LAG) continue;
        heliosLagClosures.push({ id: row.id });
      }
    }
  }

  for (let offset = 0; offset < outOfWindowClosures.length; offset += 25) {
    await Promise.all(
      outOfWindowClosures.slice(offset, offset + 25).map((row) =>
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

  for (let offset = 0; offset < heliosLagClosures.length; offset += 25) {
    await Promise.all(
      heliosLagClosures.slice(offset, offset + 25).map((row) =>
        prisma.recurringMonth.update({
          where: { id: row.id },
          data: {
            status: "CLOSED",
            paidAt: null,
            settledPeriod: null,
            note: AUTO_CLOSED_HELIOS_LAG,
          },
        }),
      ),
    );
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
    outOfWindowClosed: outOfWindowClosures.length,
    heliosLagClosed: heliosLagClosures.length,
    outOfWindowManualReview: manualReview,
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
          expiryDate: true,
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
  return rows.filter((row) =>
    isPeriodInRecurringWindow(recurringWindow(row.contract), row.period),
  );
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
