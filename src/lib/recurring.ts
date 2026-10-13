/** Periodo YYYY-MM */
export function toPeriod(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

const PERIOD_MONTH_SHORT = [
  "gen",
  "feb",
  "mar",
  "apr",
  "mag",
  "giu",
  "lug",
  "ago",
  "set",
  "ott",
  "nov",
  "dic",
] as const;

const PERIOD_MONTH_FULL = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
] as const;

export function periodLabel(period: string): string {
  const [y, m] = period.split("-");
  const mi = Number(m) - 1;
  return `${PERIOD_MONTH_SHORT[mi] ?? m} ${y}`;
}

function yearMonth(year: string, month: number): string | null {
  if (!/^\d{4}$/.test(year) || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Mese filtro → YYYY-MM, senza spostare il mese.
 * Accetta `2026-07`, `lug 2026`, `luglio 2026`, `07/2026`.
 */
export function parsePeriodToken(value: string | null | undefined): string | null {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!raw || raw === "(vuoto)") return null;

  const iso = raw.match(/^(\d{4})-(\d{2})$/);
  if (iso) return yearMonth(iso[1]!, Number(iso[2]));

  const named = raw.match(/^([a-z]+)\s+(\d{4})$/);
  if (named) {
    const name = named[1]!;
    const shortIdx = PERIOD_MONTH_SHORT.indexOf(name as (typeof PERIOD_MONTH_SHORT)[number]);
    if (shortIdx >= 0) return yearMonth(named[2]!, shortIdx + 1);
    const fullIdx = PERIOD_MONTH_FULL.indexOf(name as (typeof PERIOD_MONTH_FULL)[number]);
    if (fullIdx >= 0) return yearMonth(named[2]!, fullIdx + 1);
    return null;
  }

  const monthYear = raw.match(/^(\d{1,2})[/.](\d{4})$/);
  if (monthYear) return yearMonth(monthYear[2]!, Number(monthYear[1]));

  const yearSlashMonth = raw.match(/^(\d{4})[/.](\d{1,2})$/);
  if (yearSlashMonth) return yearMonth(yearSlashMonth[1]!, Number(yearSlashMonth[2]));

  return null;
}

/** Normalizza i mesi di un filtro colonna in YYYY-MM distinti, nell'ordine dato. */
export function normalizeMonthFilterValues(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const period = parsePeriodToken(value);
    if (!period || seen.has(period)) continue;
    seen.add(period);
    out.push(period);
  }
  return out;
}

export function parsePeriod(period: string): Date {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

export function addMonths(period: string, n: number): string {
  const d = parsePeriod(period);
  d.setMonth(d.getMonth() + n);
  return toPeriod(d);
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  // max 60 mesi di sicurezza
  for (let i = 0; i < 60; i++) {
    if (cur > to) break;
    out.push(cur);
    cur = addMonths(cur, 1);
  }
  return out;
}

/**
 * Valori canonici in DB:
 * - «Una tantum» = gettone una tantum (ex G)
 * - «M» = ricorrente mensile (Helios, Sorgenia Business, …)
 * - «R» = ricorrente annuale dopo 12 mesi (Etruria, Sinergy, …)
 * Legacy «Ricorrente» = trattato come M.
 */
export type RecurrenceKind = "Una tantum" | "M" | "R";

export const RECURRENCE_OPTIONS = [
  { value: "Una tantum" as const, short: "UT", label: "Gettone (una tantum)" },
  { value: "M" as const, short: "M", label: "Ricorrente mensile" },
  { value: "R" as const, short: "R", label: "Ricorrente annuale (12 mesi)" },
] as const;

export const RECURRING_STATUS_LABELS: Record<string, string> = {
  PAID: "Incassato da liquidare",
  LIQUIDATED: "Liquidato",
  PENDING: "In attesa",
  MISSING: "Mancato",
  CLOSED: "Chiuso",
  ERROR_UNPAID: "Non pagato (errore)",
};

type RecurrenceContractFields = {
  recurrence?: string | null;
  recurrenceKind?: "UT" | "M" | "R" | null;
};

/** Classificazione indicizzata (allineata ai filtri Prisma `recurrenceKind`). */
export function isContractRecurringMonthly(contract: RecurrenceContractFields): boolean {
  if (contract.recurrenceKind === "M") return true;
  if (contract.recurrenceKind === "R") return false;
  return isRecurringMonthly(contract.recurrence);
}

export function isContractRecurringAnnual(contract: RecurrenceContractFields): boolean {
  if (contract.recurrenceKind === "R") return true;
  if (contract.recurrenceKind === "M") return false;
  return isRecurringAnnual(contract.recurrence);
}

/** Qualsiasi forma di ricorrenza (mensile o annuale). */
export function isRecurring(recurrence: string | null | undefined): boolean {
  return isRecurringMonthly(recurrence) || isRecurringAnnual(recurrence);
}

export function isContractRecurring(contract: RecurrenceContractFields): boolean {
  return isContractRecurringMonthly(contract) || isContractRecurringAnnual(contract);
}

/** R = ricorrente annuale (dopo 12 mesi dall’ultimo pagamento / ingresso). */
export function isRecurringAnnual(recurrence: string | null | undefined): boolean {
  const r = (recurrence ?? "").trim();
  if (!r) return false;
  if (/^r$/i.test(r)) return true;
  if (/annu|12\s*mes|dopo\s*12/i.test(r)) return true;
  return false;
}

/** M = ricorrente mensile (include legacy «Ricorrente»). */
export function isRecurringMonthly(recurrence: string | null | undefined): boolean {
  const r = (recurrence ?? "").trim();
  if (!r) return false;
  if (isRecurringAnnual(r)) return false;
  if (/^m$/i.test(r)) return true;
  if (/^ricorrente$/i.test(r)) return true;
  if (/mensil/i.test(r)) return true;
  if (/ricor/i.test(r)) return true;
  return false;
}

/** Valore canonico da salvare in DB. */
export function normalizeRecurrence(
  raw: string | null | undefined,
): RecurrenceKind {
  const v = (raw ?? "").trim();
  if (!v) return "Una tantum";
  if (isRecurringAnnual(v)) return "R";
  if (isRecurringMonthly(v)) return "M";
  if (/^g$/i.test(v) || /^(ut)$/i.test(v) || /tantum|una\s*tantum|gettone/i.test(v)) {
    return "Una tantum";
  }
  return "Una tantum";
}

/** Codice corto in tabella: UT | M | R */
export function shortRecurrenceCode(recurrence: string | null | undefined): string {
  const n = normalizeRecurrence(recurrence);
  if (n === "M") return "M";
  if (n === "R") return "R";
  return "UT";
}

/** Valore della colonna enum indicizzata `Contract.recurrenceKind`. */
export function recurrenceKindOf(
  recurrence: string | null | undefined,
): "UT" | "M" | "R" {
  const n = normalizeRecurrence(recurrence);
  return n === "M" ? "M" : n === "R" ? "R" : "UT";
}

/**
 * Dati da passare a `contract.update/updateMany/create` per cambiare ricorrenza.
 *
 * Scrive SEMPRE entrambi i campi: `recurrence` (testo, usato dalla UI) e
 * `recurrenceKind` (enum indicizzato, usato da tutti i filtri). Usare questo
 * helper al posto di `{ recurrence: ... }` evita che i due campi divergano.
 */
export function recurrenceWriteData(raw: string | null | undefined): {
  recurrence: RecurrenceKind;
  recurrenceKind: "UT" | "M" | "R";
} {
  const recurrence = normalizeRecurrence(raw);
  return { recurrence, recurrenceKind: recurrenceKindOf(recurrence) };
}

/** Etichetta lunga per select / tooltip */
export function recurrenceLabel(recurrence: string | null | undefined): string {
  const n = normalizeRecurrence(recurrence);
  return RECURRENCE_OPTIONS.find((o) => o.value === n)?.label ?? "Gettone (una tantum)";
}

/**
 * Nota di sistema sulla rata annuale +12 creata all'incasso.
 * Resta nascosta in Provvigioni finché il contratto è in periodo storno.
 */
export const ANNUAL_NEXT_HIDDEN_NOTE = "Nascosta: in attesa di fine storno";

export function isAnnualNextHidden(note: string | null | undefined): boolean {
  return note === ANNUAL_NEXT_HIDDEN_NOTE;
}

/**
 * Clausola Prisma: esclude le copie annuali ancora in storno.
 * `note: { not }` da solo escluderebbe anche `note = null`.
 */
export const notAnnualNextHiddenWhere: {
  OR: Array<{ note: null } | { note: { not: string } }>;
} = {
  OR: [{ note: null }, { note: { not: ANNUAL_NEXT_HIDDEN_NOTE } }],
};

/**
 * Prima annualità già incassata/liquidata (gettone sulla riga contratto
 * oppure rate PAID/LIQUIDATED).
 *
 * Importante: la prima annualità R spesso NON ha `RecurringMonth` — resta
 * su `collectionDate` / stato unità. Contratti legacy possono essere
 * `PROVVIGIONE_LIQUIDATA` o `paymentStatus` Incassato/Pagato senza
 * `collectionDate`: senza questo segnale sync/apply/backfill saltano il +12
 * (caso Vitucci / Quadrifoglio dopo deploy #77/#78).
 */
export function isAnnualFirstYearCollected(input: {
  collectionDate?: Date | string | null;
  status?: string | null;
  paymentStatus?: string | null;
  paidOrLiquidatedPeriods?: readonly string[];
}): boolean {
  if (input.collectionDate) return true;
  if ((input.paidOrLiquidatedPeriods?.length ?? 0) > 0) return true;
  const status = (input.status ?? "").trim().toUpperCase();
  if (status === "PROVVIGIONE_LIQUIDATA") return true;
  const pay = (input.paymentStatus ?? "").trim();
  return pay === "Incassato" || pay === "Pagato";
}

/**
 * Prossima competenza annuale: ultimo incasso + 12 mesi, oppure
 * primo anniversario (ingresso fornitura + 12) se non ci sono ancora rate pagate.
 */
export function nextAnnualDuePeriod(
  supplyStartPeriod: string,
  paidPeriods: readonly string[],
): string {
  const paid = paidPeriods.filter((p) => /^\d{4}-\d{2}$/.test(p)).sort();
  const last = paid[paid.length - 1];
  if (!last) return addMonths(supplyStartPeriod, 12);
  return addMonths(last, 12);
}

/**
 * Regola annuale (R): la riga dell'anno successivo si crea SOLO al 13° mese
 * (quando il mese corrente raggiunge `nextAnnualDuePeriod`), mai prima.
 *
 * Sostituisce il comportamento precedente (PR #18, commit 1f5189c): niente
 * più copia creata subito all'incasso e nascosta in storno via
 * `ANNUAL_NEXT_HIDDEN_NOTE`. La riga appena incassata resta rossa BLOCCA da
 * sola (via `resolveStornoInfo`, indipendente da questa funzione) finché
 * dura lo storno; la copia dell'anno dopo compare solo quando è davvero
 * dovuta.
 */
export function annualNextRowDue(
  supplyStartPeriod: string,
  paidPeriods: readonly string[],
  now: Date,
): { due: boolean; period: string } {
  const period = nextAnnualDuePeriod(supplyStartPeriod, paidPeriods);
  return { due: period <= toPeriod(now), period };
}

/**
 * Competenze annuali già dovute fino a `nowPeriod` (catena +12).
 *
 * Importante: queste date cadono spesso **dopo** l'`expiryDate` formale
 * (ingresso + 12 mesi → finestra mensile chiude un mese prima dell'anniversario).
 * Sync, purge e backfill devono trattarle come legittime, non come rate
 * fuori intervallo da chiudere/saltare.
 */
export function listAnnualDuePeriodsThrough(
  supplyStartPeriod: string,
  paidPeriods: readonly string[],
  nowPeriod: string,
  alreadyPaidOrLiquidated: ReadonlySet<string> = new Set(
    paidPeriods.filter((p) => /^\d{4}-\d{2}$/.test(p)),
  ),
): string[] {
  if (!/^\d{4}-\d{2}$/.test(supplyStartPeriod) || !/^\d{4}-\d{2}$/.test(nowPeriod)) {
    return [];
  }
  const due: string[] = [];
  let nextDue = nextAnnualDuePeriod(supplyStartPeriod, paidPeriods);
  for (let i = 0; i < 10; i++) {
    if (nextDue > nowPeriod) break;
    if (alreadyPaidOrLiquidated.has(nextDue)) {
      nextDue = addMonths(nextDue, 12);
      continue;
    }
    due.push(nextDue);
    nextDue = addMonths(nextDue, 12);
  }
  return due;
}
