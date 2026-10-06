/**
 * Regola Michele (Provvigioni · ricorrenti annuali R):
 * le rate già liquidate di anni precedenti restano in DB ma in elenco
 * sono «archiviate» (nascoste). Si vedono solo:
 *   - l’ultima liquidata, e
 *   - se presente, quella da incassare (o Incassato da liquidare / PAID).
 *
 * Solo filtro UI/query — nessun soft-delete. Bypass: `?archiviate=1`.
 * Non applica a mensili (M): lì ogni mese resta operativo.
 */

/** Stati «aperti» / operativi: mai archiviati. */
export const ANNUAL_OPERATIVE_RATE_STATUSES = [
  "PENDING",
  "MISSING",
  "ERROR_UNPAID",
  "PAID",
] as const;

export type AnnualArchiveMonth = {
  period: string;
  status: string;
  note?: string | null;
};

/**
 * True se la rata annuale LIQUIDATED non è l’ultima del contratto
 * (ne esiste un’altra LIQUIDATED con periodo strettamente successivo).
 */
export function isArchivedAnnualLiquidatedRate(
  month: Pick<AnnualArchiveMonth, "period" | "status">,
  allMonths: ReadonlyArray<Pick<AnnualArchiveMonth, "period" | "status">>,
): boolean {
  if (month.status !== "LIQUIDATED") return false;
  if (!/^\d{4}-\d{2}$/.test(month.period)) return false;
  return allMonths.some(
    (other) =>
      other.status === "LIQUIDATED" &&
      /^\d{4}-\d{2}$/.test(other.period) &&
      other.period > month.period,
  );
}

/**
 * Filtra le rate di un contratto annuale (R) per l’elenco Provvigioni.
 * Conserva tutte le operative + al massimo una LIQUIDATED (la più recente).
 */
export function filterVisibleAnnualRecurringMonths<T extends AnnualArchiveMonth>(
  months: readonly T[],
  opts?: { includeArchived?: boolean },
): T[] {
  if (opts?.includeArchived) return [...months];

  const operative = months.filter((m) =>
    (ANNUAL_OPERATIVE_RATE_STATUSES as readonly string[]).includes(m.status),
  );
  const liquidated = months
    .filter((m) => m.status === "LIQUIDATED" && /^\d{4}-\d{2}$/.test(m.period))
    .sort((a, b) => b.period.localeCompare(a.period));
  const lastLiquidated = liquidated[0];

  const other = months.filter(
    (m) =>
      m.status !== "LIQUIDATED" &&
      !(ANNUAL_OPERATIVE_RATE_STATUSES as readonly string[]).includes(m.status),
  );

  const out: T[] = [...operative];
  if (lastLiquidated) out.push(lastLiquidated);
  out.push(...other);
  return out;
}

/**
 * Riga unità (primo anno / gettone contratto): nascondi se è già liquidata
 * e esiste almeno una rata RecurringMonth LIQUIDATED più «nuova» in elenco
 * (l’unità è l’anno precedente rispetto alle rate annuali successive).
 */
export function shouldShowAnnualUnitLiquidatedRow(opts: {
  contractStatus: string;
  hasLiquidatedRecurringMonth: boolean;
  includeArchived?: boolean;
}): boolean {
  if (opts.includeArchived) return true;
  if (opts.contractStatus !== "PROVVIGIONE_LIQUIDATA") return true;
  // Unità liquidata + rate liquidate successive → unità archiviata
  return !opts.hasLiquidatedRecurringMonth;
}

/** Query `?archiviate=1` / `true` / `sì`. */
export function parseIncludeArchivedAnnual(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const n = raw.trim().toLowerCase();
  return n === "1" || n === "true" || n === "si" || n === "sì" || n === "yes";
}
