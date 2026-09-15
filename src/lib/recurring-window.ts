/**
 * Intervallo di competenza delle rate ricorrenti di un contratto.
 *
 * Regola unica (vale su TUTTI i percorsi che creano `RecurringMonth`):
 *
 * - Primo mese = mese della data di inizio fornitura, **incluso** anche se la
 *   fornitura parte a metà mese (ingresso 12/05 → «mag» è il primo mese).
 *   Il fornitore riconosce il gettone del mese in cui l'utenza entra.
 * - Ultimo mese = mese di chiusura/cessazione, **incluso**.
 *   `expiryDate` è il giorno in cui l'utenza passa altrove: l'ultimo mese
 *   fatturabile è quello del giorno precedente (cessazione 01/10 → «set»,
 *   cessazione 15/10 → «ott»). Per i contratti in stato CHIUSO vale il mese
 *   dell'evento di chiusura.
 * - Nessun mese prima del primo, nessuno dopo l'ultimo.
 */
import { toPeriod } from "@/lib/recurring";
import { computeSupplyStartDate } from "@/lib/supply-dates";

/** Giorno prima (es. fornitura nuova 1/10 → ultimo giorno del vecchio 30/09). */
export function dayBefore(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - 1);
  return d;
}

export type RecurringWindowContract = {
  insertionDate: Date | null;
  supplyStartDate: Date | null;
  operationType: string | null;
  status: string | null;
  expiryDate: Date | null;
  /** Ultimo passaggio a stato CHIUSO (`statusHistory` più recente). */
  statusHistory?: Array<{ changedAt: Date }>;
};

export type RecurringWindow = {
  /** Primo mese di competenza ammesso (YYYY-MM, incluso). */
  start: string;
  /** Ultimo mese di competenza ammesso (YYYY-MM, incluso) o null se aperto. */
  end: string | null;
};

function earlierPeriod(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

/** Finestra [primo mese, ultimo mese] delle rate ricorrenti di un contratto. */
export function recurringWindow(
  contract: RecurringWindowContract,
  now: Date = new Date(),
): RecurringWindow {
  const startDate =
    contract.supplyStartDate ??
    computeSupplyStartDate(
      contract.insertionDate ?? now,
      contract.operationType,
    );
  const start = toPeriod(startDate);

  const closedPeriod =
    contract.status === "CHIUSO"
      ? toPeriod(contract.statusHistory?.[0]?.changedAt ?? now)
      : null;
  const expiryPeriod = contract.expiryDate
    ? toPeriod(dayBefore(contract.expiryDate))
    : null;

  return { start, end: earlierPeriod(closedPeriod, expiryPeriod) };
}

/** Il mese YYYY-MM rientra nell'intervallo di competenza del contratto? */
export function isPeriodInRecurringWindow(
  window: RecurringWindow,
  period: string,
): boolean {
  if (!/^\d{4}-\d{2}$/.test(period)) return false;
  if (period < window.start) return false;
  if (window.end && period > window.end) return false;
  return true;
}

export type RecurringMonthLike = {
  status: string;
  paidAt?: Date | null;
  settledPeriod?: string | null;
};

/**
 * Una rata fuori intervallo si può eliminare solo se non porta con sé
 * informazione economica: mai toccare incassato/pagato/segnalato a mano.
 */
export function isDisposableRecurringMonth(row: RecurringMonthLike): boolean {
  if (row.paidAt != null) return false;
  if (row.settledPeriod != null) return false;
  return row.status === "PENDING" || row.status === "MISSING" || row.status === "CLOSED";
}

/** Rate fuori intervallo con valore economico: vanno decise a mano. */
export function needsManualReviewOutOfWindow(row: RecurringMonthLike): boolean {
  return !isDisposableRecurringMonth(row);
}

export const OUT_OF_WINDOW_REASONS = {
  beforeStart: "prima dell'inizio fornitura",
  afterEnd: "successiva alla chiusura del contratto",
} as const;

export function outOfWindowReason(
  window: RecurringWindow,
  period: string,
): string | null {
  if (period < window.start) return OUT_OF_WINDOW_REASONS.beforeStart;
  if (window.end && period > window.end) return OUT_OF_WINDOW_REASONS.afterEnd;
  return null;
}
