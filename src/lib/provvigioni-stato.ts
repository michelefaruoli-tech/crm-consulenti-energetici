/**
 * Tipi e helper Provvigioni usabili sia dal Server Component (page)
 * sia dal Client Component (tabella). Non mettere "use client" qui.
 */

export type ProvvigioneRow = {
  id: string;
  clientId: string;
  commissionId: string;
  clientName: string;
  podPdr: string;
  collaboratorName: string;
  supplierName: string;
  clientType: string;
  amount: string;
  recurrence: string;
  /** Stato semplificato: KO / Cessato | Da incassare | Incassato */
  stato: string;
  paymentStatus: string;
  confirmed: string;
  collectionMonth: string;
  notes: string;
  stornoLabel?: string;
  stornoRowClass?: string;
  warnOnEdit?: boolean;
  gettoneBorderClass?: string;
};

/** Tre valori usati in Provvigioni (facilita correzione KO/Cessato sbagliati). */
export function simplifiedProvvigioneStato(
  status: string,
  hasCollectionDate: boolean,
): string {
  if (["KO", "ANNULLATO", "CHIUSO"].includes(status)) return "KO / Cessato";
  if (hasCollectionDate) return "Incassato";
  return "Da incassare";
}

export const PROVVIGIONE_STATO_OPTIONS = [
  "KO / Cessato",
  "Da incassare",
  "Incassato",
] as const;
