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

/**
 * Stato in Provvigioni.
 * Se c’è una data di incasso → sempre «Incassato» (priorità su KO/Chiuso).
 */
export function simplifiedProvvigioneStato(
  status: string,
  hasCollectionDate: boolean,
): string {
  if (hasCollectionDate) return "Incassato";
  if (["KO", "ANNULLATO", "CHIUSO"].includes(status)) return "KO / Cessato";
  return "Da incassare";
}

export const PROVVIGIONE_STATO_OPTIONS = [
  "KO / Cessato",
  "Da incassare",
  "Incassato",
] as const;

/**
 * Gettone standard per clienti privati (Domestico) per fornitore.
 * Dolomiti 45 · Plenitude 60 · Enel 65
 */
export function defaultGettonePrivato(supplierName: string): number | null {
  const n = supplierName.toLowerCase().replace(/\s+/g, "");
  if (n.includes("dolomit")) return 45;
  if (n.includes("plenitud") || n.includes("enipro")) return 60;
  if (n.includes("enel")) return 65;
  return null;
}

/**
 * Collaboratore: cognome per esteso + iniziale del nome (es. «Faruoli M.»).
 * Assume ordine «Cognome Nome» (come negli elenchi italiani).
 */
export function formatCollaboratorShort(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  const cognome = parts[0];
  const nome = parts.slice(1).join(" ");
  const iniziale = nome.charAt(0).toUpperCase();
  return iniziale ? `${cognome} ${iniziale}.` : cognome;
}
