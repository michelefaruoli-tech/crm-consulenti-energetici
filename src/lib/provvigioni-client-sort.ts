/**
 * Ordinamento colonna Nominativo.
 *
 * La cella mostra `clientDisplayName` (ragione sociale solo per le aziende,
 * altrimenti «Cognome Nome»). L'ordine della tabella usa quella stringa,
 * sulle righe già filtrate, e solo dopo si taglia la pagina.
 */
import { clientDisplayName } from "@/lib/utils";

export type VisibleClientNameSource = {
  type?: string | null;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

const NAME_COLLATOR: Intl.CollatorOptions = {
  sensitivity: "base",
  numeric: true,
};

/** Testo identico a quello della cella Nominativo. */
export function visibleClientName(client: VisibleClientNameSource): string {
  return clientDisplayName({
    type: client.type ?? "PRIVATO",
    companyName: client.companyName,
    firstName: client.firstName,
    lastName: client.lastName,
  });
}

export function compareVisibleNameStrings(a: string, b: string): number {
  return a.localeCompare(b, "it", NAME_COLLATOR);
}

/**
 * A→Z / Z→A sul nome visibile. `tieBreak` non si inverte col verso:
 * a parità di nominativo l'ordine resta stabile tra un clic e l'altro.
 */
export function sortByVisibleClientName<T>(
  items: readonly T[],
  clientOf: (item: T) => VisibleClientNameSource,
  dir: "asc" | "desc",
  tieBreak?: (a: T, b: T) => number,
): T[] {
  const sign = dir === "desc" ? -1 : 1;
  return [...items].sort((a, b) => {
    const cmp = compareVisibleNameStrings(
      visibleClientName(clientOf(a)),
      visibleClientName(clientOf(b)),
    );
    if (cmp !== 0) return cmp * sign;
    return tieBreak?.(a, b) ?? 0;
  });
}

/** Ordina l'insieme filtrato e poi prende la pagina. */
export function pageByVisibleClientName<T>(
  items: readonly T[],
  clientOf: (item: T) => VisibleClientNameSource,
  dir: "asc" | "desc",
  skip: number,
  take: number,
  tieBreak?: (a: T, b: T) => number,
): T[] {
  return sortByVisibleClientName(items, clientOf, dir, tieBreak).slice(
    skip,
    skip + take,
  );
}
