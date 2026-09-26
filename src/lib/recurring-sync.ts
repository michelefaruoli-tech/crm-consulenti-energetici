import { prisma } from "@/lib/prisma";
import {
  addMonths,
  ANNUAL_NEXT_HIDDEN_NOTE,
  isAnnualNextHidden,
  isRecurring,
  isRecurringAnnual,
  isRecurringMonthly,
  monthsBetween,
  nextAnnualDuePeriod,
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
  RECURRING_AUTO_CLOSED_NOTE,
  recurringWindow,
  type RecurringWindow,
} from "@/lib/recurring-window";
import {
  isHeliosCompetenceNotYetPayable,
  isHeliosSupplier,
  recurringGenerationLagMonths,
} from "@/lib/helios-contract-rules";
import {
  recurringAnnualWhereOr,
  recurringMonthlyWhereOr,
} from "@/lib/provvigioni-filters";
import { computeSupplyStartDate } from "@/lib/supply-dates";
import type { Prisma } from "@/generated/prisma/client";

const PRESERVED_STATUSES = new Set([
  "CLOSED",
  "ERROR_UNPAID",
  "PAID",
  "LIQUIDATED",
]);

const AUTO_CLOSED_BEFORE_START = RECURRING_AUTO_CLOSED_NOTE.beforeStart;
const AUTO_CLOSED_AFTER_END = RECURRING_AUTO_CLOSED_NOTE.afterEnd;
const AUTO_CLOSED_HELIOS_LAG = RECURRING_AUTO_CLOSED_NOTE.heliosLag;

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
    if (isAnnualNextHidden(row.note)) continue;
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
      stornoEndDate: true,
      status: true,
      expiryDate: true,
      statusHistory: {
        where: { toStatus: "CHIUSO" },
        select: { changedAt: true },
        orderBy: { changedAt: "desc" },
        take: 1,
      },
      commission: { select: { expected: true } },
      supplier: { select: { name: true, stornoMonths: true } },
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

  const amount = Number(contract.commission?.expected ?? 0) || null;

  if (isRecurringAnnual(contract.recurrence)) {
    if (contract.status !== "CHIUSO") {
      await syncAnnualPeriods(contractId, contract, amount, nowDate);
    }
    return;
  }

  if (!isRecurringMonthly(contract.recurrence)) return;

  const lastPeriod = lastGeneratedPeriod(
    window,
    nowDate,
    recurringGenerationLagMonths(contract.supplier?.name),
  );

  if (start <= lastPeriod) {
    const periods = monthsBetween(start, lastPeriod);
    for (const period of periods) {
      await upsertMonthStatus(contractId, period, now, amount);
    }
  }
}

type AnnualSyncContract = {
  insertionDate: Date | null;
  supplyStartDate: Date | null;
  operationType: string | null;
  collectionDate: Date | null;
  stornoEndDate: Date | null;
  supplier: { stornoMonths: number | null } | null;
};

/**
 * Regola annuale (R): la riga della competenza successiva (+12 mesi
 * dall'ultimo incasso) si crea SOLO al 13° mese — quando il mese corrente
 * raggiunge quella competenza — mai prima. Vedi `annualNextRowDue` in
 * `recurring.ts` e docs/regole-provvigioni.md.
 *
 * Sostituisce il comportamento di PR #18 (commit 1f5189c): non crea più la
 * copia subito all'incasso nascosta in storno (`ANNUAL_NEXT_HIDDEN_NOTE`).
 * La riga appena incassata resta rossa BLOCCA da sola se lo storno non è
 * ancora finito: quel colore arriva da `resolveStornoInfo` (storno-status.ts)
 * ed è indipendente da questa funzione, quindi non serve più nascondere nulla.
 *
 * Se esiste già una riga creata in anticipo da versioni precedenti del CRM
 * (periodo non ancora arrivato), questa funzione non la tocca: la bonifica
 * passa solo dal pannello Anteprima → Applica in Backup (mai in automatico,
 * vedi `provvigioni-integrity.ts`).
 */
async function syncAnnualPeriods(
  contractId: string,
  contract: AnnualSyncContract,
  amount: number | null,
  now: Date,
): Promise<void> {
  const months = await prisma.recurringMonth.findMany({
    where: { contractId },
    select: {
      id: true,
      period: true,
      status: true,
      amount: true,
      note: true,
      paidAt: true,
      settledPeriod: true,
    },
  });

  const paid = months.filter(
    (row) => row.status === "PAID" || row.status === "LIQUIDATED",
  );
  const firstYearCollected = Boolean(contract.collectionDate) || paid.length > 0;

  if (!firstYearCollected) {
    for (const row of months) {
      if (!isDisposableRecurringMonth(row)) continue;
      if (row.status !== "PENDING" && row.status !== "MISSING") continue;
      await prisma.recurringMonth.delete({ where: { id: row.id } }).catch(() => undefined);
    }
    return;
  }

  const supplyStart =
    contract.supplyStartDate ??
    computeSupplyStartDate(contract.insertionDate ?? now, contract.operationType);
  const supplyStartPeriod = toPeriod(supplyStart);

  const byPeriod = new Map(months.map((row) => [row.period, row]));
  let nextDue = nextAnnualDuePeriod(
    supplyStartPeriod,
    paid.map((row) => row.period),
  );

  // Concatena le competenze già pagate/liquidate (es. rientro dopo anni fermi).
  for (let i = 0; i < 10; i++) {
    const existing = byPeriod.get(nextDue);
    if (existing && (existing.status === "PAID" || existing.status === "LIQUIDATED")) {
      nextDue = addMonths(nextDue, 12);
      continue;
    }
    break;
  }

  const nowPeriod = toPeriod(now);
  // Non ancora al 13° mese: nessuna riga da creare. Non tocchiamo neanche
  // un'eventuale riga già esistente creata in anticipo (vedi commento sopra).
  if (nextDue > nowPeriod) return;

  const existing = byPeriod.get(nextDue);
  const keptPeriod = nextDue;

  if (existing?.status === "ERROR_UNPAID") {
    // Riga già segnalata come errore: resta così, non sovrascrivere.
  } else if (!existing) {
    const status = nextDue < nowPeriod ? "MISSING" : "PENDING";
    await prisma.recurringMonth.create({
      data: { contractId, period: nextDue, status, amount, paidAt: null },
    });
  } else {
    const autoClosed =
      existing.status === "CLOSED" &&
      (existing.note === AUTO_CLOSED_BEFORE_START ||
        existing.note === AUTO_CLOSED_AFTER_END ||
        existing.note === AUTO_CLOSED_HELIOS_LAG ||
        isAnnualNextHidden(existing.note));
    if (
      PRESERVED_STATUSES.has(existing.status) &&
      !autoClosed &&
      !isAnnualNextHidden(existing.note)
    ) {
      // PAID / LIQUIDATED / CLOSED (non auto) / ERROR_UNPAID già gestiti: non toccare.
    } else {
      const status = nextDue < nowPeriod ? "MISSING" : "PENDING";
      await prisma.recurringMonth.update({
        where: { id: existing.id },
        data: {
          status,
          amount: amount ?? existing.amount,
          paidAt: null,
          settledPeriod: null,
          // Rivela una eventuale riga nascosta legacy (PR #18) diventata dovuta ora.
          note: isAnnualNextHidden(existing.note) ? null : existing.note,
        },
      });
    }
  }

  for (const row of months) {
    if (row.period === keptPeriod) continue;
    if (row.status === "PAID" || row.status === "LIQUIDATED" || row.status === "ERROR_UNPAID") {
      continue;
    }
    if (row.paidAt || row.settledPeriod) continue;
    // Riga non ancora dovuta (periodo futuro): mai toccarla qui, solo bonifica manuale.
    if (row.period > nowPeriod) continue;
    if (row.status === "PENDING" || row.status === "MISSING") {
      await prisma.recurringMonth
        .delete({ where: { id: row.id } })
        .catch(() => undefined);
    }
  }
}

export type BackfillUpsertOutcome = "creata" | "aggiornata" | "saltata";

/** Crea o riapre una singola rata mensile prevista dal piano di backfill. */
export async function upsertMonthlyBackfillPeriod(
  contractId: string,
  period: string,
  amount: number | null,
  nowDate: Date = new Date(),
): Promise<{ outcome: BackfillUpsertOutcome; motivo?: string }> {
  const before = await prisma.recurringMonth.findUnique({
    where: { contractId_period: { contractId, period } },
    select: { id: true, status: true, note: true },
  });
  const now = toPeriod(nowDate);
  await upsertMonthStatus(contractId, period, now, amount);
  const after = await prisma.recurringMonth.findUnique({
    where: { contractId_period: { contractId, period } },
    select: { id: true, status: true, note: true },
  });
  if (!after) {
    return { outcome: "saltata", motivo: "Scrittura non riuscita" };
  }
  if (!before) {
    return { outcome: "creata" };
  }
  const reopened =
    before.status === "CLOSED" &&
    (before.note === AUTO_CLOSED_BEFORE_START ||
      before.note === AUTO_CLOSED_AFTER_END ||
      before.note === AUTO_CLOSED_HELIOS_LAG);
  if (reopened && (after.status === "MISSING" || after.status === "PENDING")) {
    return { outcome: "aggiornata", motivo: "Rata riaperta (chiusura automatica)" };
  }
  if (before.status !== after.status) {
    return { outcome: "aggiornata" };
  }
  return {
    outcome: "saltata",
    motivo: "Rata già presente e non modificabile (Incassato/Pagato o chiusa manualmente)",
  };
}

/** Crea o riapre la rata annuale per un periodo già dovuto (regola 13° mese). */
export async function upsertAnnualBackfillPeriod(
  contractId: string,
  period: string,
  amount: number | null,
  nowDate: Date = new Date(),
): Promise<{ outcome: BackfillUpsertOutcome; motivo?: string }> {
  const before = await prisma.recurringMonth.findUnique({
    where: { contractId_period: { contractId, period } },
    select: { id: true, status: true, note: true },
  });
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: {
      insertionDate: true,
      supplyStartDate: true,
      operationType: true,
      collectionDate: true,
      stornoEndDate: true,
      supplier: { select: { stornoMonths: true } },
    },
  });
  if (!contract) {
    return { outcome: "saltata", motivo: "Contratto non trovato" };
  }
  const nowPeriod = toPeriod(nowDate);
  if (period > nowPeriod) {
    return { outcome: "saltata", motivo: "Competenza annuale non ancora dovuta (13° mese)" };
  }

  const months = await prisma.recurringMonth.findMany({
    where: { contractId },
    select: { id: true, period: true, status: true, amount: true, note: true },
  });
  const paid = months.filter((r) => r.status === "PAID" || r.status === "LIQUIDATED");
  const firstYearCollected = Boolean(contract.collectionDate) || paid.length > 0;
  if (!firstYearCollected) {
    return {
      outcome: "saltata",
      motivo: "Primo anno non ancora incassato: nessuna rata annuale da generare",
    };
  }

  const existing = months.find((r) => r.period === period);
  if (
    existing &&
    (existing.status === "PAID" ||
      existing.status === "LIQUIDATED" ||
      existing.status === "ERROR_UNPAID")
  ) {
    return { outcome: "saltata", motivo: "Rata già incassata o segnalata" };
  }
  if (
    existing?.status === "CLOSED" &&
    existing.note !== AUTO_CLOSED_BEFORE_START &&
    existing.note !== AUTO_CLOSED_AFTER_END &&
    existing.note !== AUTO_CLOSED_HELIOS_LAG
  ) {
    return { outcome: "saltata", motivo: "Rata chiusa manualmente" };
  }

  const status = period < nowPeriod ? "MISSING" : "PENDING";
  if (!existing) {
    await prisma.recurringMonth.create({
      data: { contractId, period, status, amount, paidAt: null },
    });
    return { outcome: "creata" };
  }

  const autoClosed =
    existing.status === "CLOSED" &&
    (existing.note === AUTO_CLOSED_BEFORE_START ||
      existing.note === AUTO_CLOSED_AFTER_END ||
      existing.note === AUTO_CLOSED_HELIOS_LAG ||
      isAnnualNextHidden(existing.note));
  if (existing.status === status && !autoClosed && existing.amount != null) {
    return { outcome: "saltata", motivo: "Già aggiornata" };
  }
  await prisma.recurringMonth.update({
    where: { id: existing.id },
    data: {
      status,
      amount: amount ?? existing.amount,
      paidAt: null,
      settledPeriod: null,
      note: autoClosed || isAnnualNextHidden(existing.note) ? null : existing.note,
    },
  });
  return before ? { outcome: "aggiornata" } : { outcome: "creata" };
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
      if (isAnnualNextHidden(row.note)) continue;
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
    outOfWindowManualReview: manualReview,
  });
  return contracts.length;
}

/**
 * Segnalazioni rate mancanti/pending.
 * `contractScope` = stesso perimetro di Provvigioni (`panelContractScopeWhere`:
 * visibility di ruolo + eventuale filtro collab UI). Stringa = solo un
 * collaboratorId (compatibilità call site vecchi).
 */
export async function getMissingRecurringAlerts(
  contractScope?: Prisma.ContractWhereInput | string,
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

  const scopeWhere =
    typeof contractScope === "string"
      ? { collaboratorId: contractScope }
      : contractScope && Object.keys(contractScope).length > 0
        ? contractScope
        : undefined;

  const rows = await prisma.recurringMonth.findMany({
    where: {
      status: { in: ["MISSING", "PENDING"] },
      period: periodFilter,
      AND: [{ OR: [{ note: null }, { note: { not: ANNUAL_NEXT_HIDDEN_NOTE } }] }],
      contract: {
        AND: [
          {
            isHistorical: false,
            deletedAt: null,
            status: { notIn: ["KO", "ANNULLATO", "CHIUSO"] },
            ...recurrenceFilter,
          },
          ...(scopeWhere ? [scopeWhere] : []),
        ],
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
  return rows.filter((row) => {
    if (!isPeriodInRecurringWindow(recurringWindow(row.contract), row.period)) {
      return false;
    }
    if (
      isHeliosSupplier(row.contract.supplier.name) &&
      isHeliosCompetenceNotYetPayable(row.period)
    ) {
      return false;
    }
    return true;
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
export async function getHeliosAbsentAlerts(
  contractScope?: Prisma.ContractWhereInput | string,
) {
  const scopeWhere =
    typeof contractScope === "string"
      ? { collaboratorId: contractScope }
      : contractScope && Object.keys(contractScope).length > 0
        ? contractScope
        : undefined;

  return prisma.recurringMonth.findMany({
    where: {
      status: "ERROR_UNPAID",
      note: { contains: "ASSENTE_RENDICONTO" },
      contract: {
        AND: [
          {
            isHistorical: false,
            deletedAt: null,
            supplier: { name: { equals: "Helios", mode: "insensitive" } },
          },
          ...(scopeWhere ? [scopeWhere] : []),
        ],
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
