/**
 * Liste di valori nei parametri URL dei filtri (separatore `|`).
 * Modulo senza dipendenze: lo usano sia il server sia i componenti client.
 */

/** Separatore URL per filtri multipli (es. `Da incassare|Incassato`). */
export const FILTER_LIST_SEP = "|";

export function parseFilterList(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(FILTER_LIST_SEP)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function formatFilterList(values: string[]): string | null {
  const cleaned = values.map((s) => s.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  return cleaned.join(FILTER_LIST_SEP);
}
