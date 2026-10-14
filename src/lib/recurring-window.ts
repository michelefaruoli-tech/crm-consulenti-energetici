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
import { addMonths, isAnnualNextHidden, isRecurringMonthly, toPeriod } from "@/lib/recurring";
import { MONTHLY_SWITCH_KO_NOTE_PREFIX } from "@/lib/provvigioni-filters";
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
  note?: string | null;
};

/**
 * Una rata fuori intervallo si può eliminare solo se non porta con sé
 * informazione economica: mai toccare incassato/pagato/segnalato a mano.
 * La copia annuale +12 nascosta in storno non è usa-e-getta: va mostrata
 * a fine storno anche se cade dopo la scadenza formale dei 12 mesi.
 */
export function isDisposableRecurringMonth(row: RecurringMonthLike): boolean {
  if (row.paidAt != null) return false;
  if (row.settledPeriod != null) return false;
  if (isAnnualNextHidden(row.note)) return false;
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

/** Note automatiche su rate `CLOSED` esclusa dal sync (non contano come rata presente). */
export const RECURRING_AUTO_CLOSED_NOTE = {
  beforeStart: "Esclusa: precedente all'ingresso in fornitura",
  afterEnd: "Esclusa: successiva alla chiusura del contratto",
  heliosLag: "Esclusa: Helios non ha ancora pagato questa competenza (lag 1 mese)",
} as const;

/** Nota lag scritta quando la regola era ancora M+2. Resta una chiusura automatica. */
export const HELIOS_LAG_AUTO_NOTE_LEGACY =
  "Esclusa: Helios non ha ancora pagato questa competenza (lag 2 mesi)";

export function isHeliosLagAutoNote(note: string | null | undefined): boolean {
  return (
    note === RECURRING_AUTO_CLOSED_NOTE.heliosLag ||
    note === HELIOS_LAG_AUTO_NOTE_LEGACY
  );
}

export function isAutomaticClosedRecurringMonth(row: RecurringMonthLike): boolean {
  if (row.status !== "CLOSED") return false;
  const note = row.note ?? "";
  return (
    note === RECURRING_AUTO_CLOSED_NOTE.beforeStart ||
    note === RECURRING_AUTO_CLOSED_NOTE.afterEnd ||
    isHeliosLagAutoNote(note)
  );
}

/**
 * Per il backfill / controllo integrità: la competenza è già coperta da una
 * rata che non va ricreata (incassata, in attesa, chiusa manualmente, …).
 * Le chiusure automatiche fuori regola NON contano: vanno riaperte.
 */
export function periodSatisfiedForBackfill(
  row: RecurringMonthLike | undefined,
): boolean {
  if (!row) return false;
  if (isAutomaticClosedRecurringMonth(row)) return false;
  if (row.status === "PENDING" || row.status === "MISSING") return true;
  if (row.status === "PAID" || row.status === "LIQUIDATED") return true;
  if (row.status === "ERROR_UNPAID") return true;
  if (row.status === "CLOSED") return true;
  return false;
}

export function outOfWindowReason(
  window: RecurringWindow,
  period: string,
): string | null {
  if (period < window.start) return OUT_OF_WINDOW_REASONS.beforeStart;
  if (window.end && period > window.end) return OUT_OF_WINDOW_REASONS.afterEnd;
  return null;
}

/**
 * Ultimo mese ancora in fornitura da non chiudere quando un ricorrente
 * mensile passa KO perché sullo stesso POD entra un contratto nuovo.
 *
 * Esempio: nuovo fornitore dal 1° ottobre → expiry 30/09 → resta settembre,
 * se quel mese è già nel mese pagato (Helios: calendario − 1).
 * Un KO vero (senza nota di switch, o senza scadenza) non preserva nulla.
 */
export function preservedMonthlySwitchPeriod(opts: {
  status: string | null | undefined;
  recurrence: string | null | undefined;
  koNotes: string | null | undefined;
  window: RecurringWindow;
  lastGenerated: string;
}): string | null {
  if (opts.status !== "KO") return null;
  if (!isRecurringMonthly(opts.recurrence)) return null;
  if (!opts.koNotes?.startsWith(MONTHLY_SWITCH_KO_NOTE_PREFIX)) return null;
  const end = opts.window.end;
  if (!end) return null;
  if (end < opts.window.start) return null;
  if (end > opts.lastGenerated) return null;
  return end;
}

/** CLOSED senza date e senza nota manuale: il sync dello switch può riaprirla. */
export function isBareClosedRecurringMonth(row: RecurringMonthLike): boolean {
  if (row.status !== "CLOSED") return false;
  if (row.paidAt != null) return false;
  if (row.settledPeriod != null) return false;
  const note = row.note?.trim() ?? "";
  return note === "" || isHeliosLagAutoNote(note);
}

export type PreservedSwitchMonthPlan =
  | { kind: "create"; status: "MISSING" | "PENDING" }
  | { kind: "reopen"; status: "MISSING" | "PENDING" }
  | { kind: "keep" };

/**
 * Cosa fare della rata dell'ultimo mese tenuto dopo un KO da switch.
 * PAID / LIQUIDATED / ERROR_UNPAID e le chiusure con nota manuale restano.
 */
export function preservedSwitchMonthPlan(
  row: RecurringMonthLike | undefined,
  period: string,
  nowPeriod: string,
): PreservedSwitchMonthPlan {
  const status = period < nowPeriod ? "MISSING" : "PENDING";
  if (!row) return { kind: "create", status };
  if (
    row.status === "PAID" ||
    row.status === "LIQUIDATED" ||
    row.status === "ERROR_UNPAID" ||
    row.status === "PENDING" ||
    row.status === "MISSING"
  ) {
    return { kind: "keep" };
  }
  if (isBareClosedRecurringMonth(row)) return { kind: "reopen", status };
  return { kind: "keep" };
}

/**
 * Ultimo mese di competenza da generare automaticamente.
 * Con `generationLagMonths` (Helios = 1): non creare mesi oltre mese_calendario − 1.
 *
 * Helios: a ottobre 2026 il mese pagato è settembre; a novembre è ottobre.
 * Mai rate future in anticipo.
 */
export function lastGeneratedPeriod(
  window: RecurringWindow,
  now: Date,
  generationLagMonths = 0,
): string {
  const nowPeriod = toPeriod(now);
  const effectiveNow =
    generationLagMonths > 0 ? addMonths(nowPeriod, -generationLagMonths) : nowPeriod;
  if (window.end && window.end < effectiveNow) return window.end;
  return effectiveNow;
}
