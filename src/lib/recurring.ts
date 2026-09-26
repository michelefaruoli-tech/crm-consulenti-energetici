/** Periodo YYYY-MM */
export function toPeriod(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function periodLabel(period: string): string {
  const [y, m] = period.split("-");
  const months = [
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
  ];
  const mi = Number(m) - 1;
  return `${months[mi] ?? m} ${y}`;
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
  PAID: "Incassato",
  LIQUIDATED: "Pagato",
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
