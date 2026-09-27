/**
 * P1.1 B4 — colonne operative M/R (sola lettura / mapping UI).
 *
 * - Competenza = mese riferimento della rata (`period`)
 * - Mese previsto = mese in cui il fornitore dovrebbe pagare (Helios = competenza + 2)
 * - Ritardo = giorni oltre la fine del mese previsto, solo se ancora «Da incassare»
 *
 * Non cambia motore Helios / no-anticipo / switch.
 */
import {
  HELIOS_RECURRING_GENERATION_LAG_MONTHS,
  isHeliosSupplier,
  recurringGenerationLagMonths,
} from "@/lib/helios-contract-rules";
import { addMonths, parsePeriod, periodLabel, toPeriod } from "@/lib/recurring";
import { canonicalizeProvvigioneStato } from "@/lib/provvigioni-stato";

function validYearMonth(value: string | null | undefined): string | null {
  const period = String(value ?? "").trim();
  return /^\d{4}-\d{2}$/.test(period) ? period : null;
}

/**
 * Mese in cui l'incasso è atteso (YYYY-MM).
 * Helios: competenza + lag M+2; altri fornitori: stessa competenza.
 */
export function expectedPayablePeriod(
  competencePeriod: string | null | undefined,
  supplierName: string | null | undefined,
): string | null {
  const competence = validYearMonth(competencePeriod);
  if (!competence) return null;
  const lag = recurringGenerationLagMonths(supplierName);
  return lag > 0 ? addMonths(competence, lag) : competence;
}

/** Etichetta UI «mese previsto» (es. «ott 2026»). */
export function expectedPayableLabel(
  competencePeriod: string | null | undefined,
  supplierName: string | null | undefined,
): string {
  const period = expectedPayablePeriod(competencePeriod, supplierName);
  return period ? periodLabel(period) : "";
}

/**
 * Giorni di ritardo rispetto alla fine del mese previsto.
 * Restituisce `null` quando non è sensato (già incassato/liquidato/stornato/KO,
 * o ancora dentro il mese previsto, o competenza assente).
 */
export function operativeDelayDays(opts: {
  stato: string;
  expectedPeriod: string | null | undefined;
  now?: Date;
}): number | null {
  const statoKey = canonicalizeProvvigioneStato(opts.stato);
  // Solo coda «Da incassare»: dopo l'incasso il ritardo non ha senso operativo.
  if (statoKey !== "Da incassare") return null;
  const expected = validYearMonth(opts.expectedPeriod);
  if (!expected) return null;

  const now = opts.now ?? new Date();
  const current = toPeriod(now);
  if (current <= expected) return null;

  // Fine mese previsto = giorno prima del 1° del mese successivo.
  const startNext = parsePeriod(addMonths(expected, 1));
  const endExpectedMs = startNext.getTime() - 24 * 60 * 60 * 1000;
  const days = Math.floor((now.getTime() - endExpectedMs) / (24 * 60 * 60 * 1000));
  return days > 0 ? days : null;
}

/** Valore cella ritardo: «12 gg» oppure stringa vuota. */
export function operativeDelayLabel(days: number | null | undefined): string {
  if (days == null || days <= 0) return "";
  return `${days} gg`;
}

/**
 * Competenze da cercare in DB quando l'utente filtra per mese previsto P.
 * Helios: P − 2; non-Helios: P.
 */
export function competencePeriodsForExpectedPayable(
  expectedPeriods: string[],
): { helios: string[]; other: string[] } {
  const helios: string[] = [];
  const other: string[] = [];
  for (const raw of expectedPeriods) {
    const p = validYearMonth(raw);
    if (!p) continue;
    other.push(p);
    helios.push(addMonths(p, -HELIOS_RECURRING_GENERATION_LAG_MONTHS));
  }
  return {
    helios: Array.from(new Set(helios)),
    other: Array.from(new Set(other)),
  };
}

/** Helios supplier match usato nei where Prisma (allineato alle liste M). */
export const HELIOS_SUPPLIER_NAME_CONTAINS = "helios";

export function isHeliosRowSupplier(name: string | null | undefined): boolean {
  return isHeliosSupplier(name);
}

/** Export lag per smoke test B4 (agosto → ottobre). */
export { HELIOS_RECURRING_GENERATION_LAG_MONTHS };
