/**
 * Tipi e costanti condivisi (client-safe) per la bonifica annuali anni passati.
 * Nessun import Prisma / server-only.
 */

/** Competenze con `period` >= questa soglia restano aperte (2026+). */
export const ANNUAL_PAST_YEARS_OPEN_FROM = "2026-01";

/** Nota scritta sulle rate liquidate dalla bonifica (idempotenza / audit). */
export const ANNUAL_PAST_YEARS_MONTH_NOTE =
  "Bonifica annuali: anni passati liquidati (pre-2026)";

/** Nota audit su liquidazione gettone contratto (riga unità anni passati). */
export const ANNUAL_PAST_YEARS_CONTRACT_NOTE =
  "Bonifica annuali: gettone anni passati liquidato (pre-2026)";

export const ANNUAL_PAST_YEARS_SCAN_BATCH = 200;
export const ANNUAL_PAST_YEARS_APPLY_BATCH = 80;
export const ANNUAL_PAST_YEARS_AUTO_MAX_BATCHES = 12;

export type AnnualPastYearsTargetKind = "month" | "contract";

export type AnnualPastYearsRow = {
  id: string;
  kind: AnnualPastYearsTargetKind;
  contractId: string;
  contractLabel: string;
  collaboratorName: string;
  supplierName: string;
  /** Periodo competenza YYYY-MM (rata) oppure competenza unità contratto. */
  period: string;
  periodLabel: string;
  status: string;
  amount: number | null;
};

/**
 * True se la competenza è strettamente precedente all'anno da lasciare aperto.
 * Accetta solo `YYYY-MM`.
 */
export function isAnnualPastPeriod(
  period: string,
  openFrom: string = ANNUAL_PAST_YEARS_OPEN_FROM,
): boolean {
  if (!/^\d{4}-\d{2}$/.test(period)) return false;
  if (!/^\d{4}-\d{2}$/.test(openFrom)) return false;
  return period < openFrom;
}

/**
 * Rate RecurringMonth da liquidare: annuali con competenza passata
 * e non già LIQUIDATED.
 */
export function shouldLiquidateAnnualMonth(row: {
  period: string;
  status: string;
}): boolean {
  if (!isAnnualPastPeriod(row.period)) return false;
  return row.status !== "LIQUIDATED";
}

const CONTRACT_SKIP_STATUSES = new Set([
  "PROVVIGIONE_LIQUIDATA",
  "KO",
  "ANNULLATO",
  "STORNATO",
]);

/**
 * Gettone/unità contratto annuale da liquidare: competenza unità < 2026
 * e non già liquidato / KO / annullato / stornato.
 */
export function shouldLiquidateAnnualContractUnit(input: {
  status: string;
  unitPeriod: string | null;
}): boolean {
  if (!input.unitPeriod || !isAnnualPastPeriod(input.unitPeriod)) return false;
  return !CONTRACT_SKIP_STATUSES.has(input.status);
}

/** Periodo YYYY-MM dalla data di competenza unità (ingresso fornitura). */
export function annualUnitCompetencePeriod(
  supplyStartDate: Date | null | undefined,
  collectionDate: Date | null | undefined,
  insertionDate: Date | null | undefined,
): string | null {
  const d = supplyStartDate ?? collectionDate ?? insertionDate ?? null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
