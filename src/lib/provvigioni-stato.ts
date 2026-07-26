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
  /** Gettone effettivo mostrato in colonna Gettone */
  amount: string;
  /** Etichetta tipo operazione (Switch, Voltura, …) */
  operationType: string;
  recurrence: string;
  /** Stato semplificato: KO / Cessato | Da incassare | Incassato */
  stato: string;
  paymentStatus: string;
  confirmed: string;
  collectionMonth: string;
  /** Storno gettone: Sì / No */
  stornoFlag: string;
  /** Data storno MM/AAAA */
  stornoMonth: string;
  /** Importo gettone da stornare */
  stornoAmount: string;
  notes: string;
  /** Etichetta periodo rischio (solo lettura / colori riga) */
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

/** Opzioni modificabili in tabella Provvigioni (etichette UI). */
export const PROVVIGIONE_OPERATION_OPTIONS = [
  "Switch",
  "Voltura",
  "Attivazione",
  "Subentro",
  "Nuova attivazione",
  "Cessazione",
  "Rinnovo",
  "Altro",
] as const;

/** Valore DB → etichetta UI */
export function operationTypeLabel(raw: string | null | undefined): string {
  const v = (raw ?? "").trim().toUpperCase().replace(/\s+/g, "_");
  if (!v) return "Switch";
  if (v === "CAMBIO" || v === "SWITCH" || v === "CAMBIO_FORNITORE") return "Switch";
  if (v === "VOLTURA") return "Voltura";
  if (v === "ATTIVAZIONE" || v === "ATTIVAZIONI") return "Attivazione";
  if (v === "SUBENTRO") return "Subentro";
  if (v === "NUOVA_ATTIVAZIONE") return "Nuova attivazione";
  if (v === "CESSAZIONE" || v === "CESSATO" || v === "DISDETTA") return "Cessazione";
  if (v === "RINNOVO") return "Rinnovo";
  if (v === "ALTRO") return "Altro";
  return raw?.trim() || "Switch";
}

/** Etichetta UI → valore da salvare in DB */
export function operationTypeFromLabel(label: string): string {
  const t = label.trim().toLowerCase();
  if (t.includes("voltura")) return "VOLTURA";
  if (t.includes("subentro")) return "SUBENTRO";
  if (t.includes("nuova")) return "NUOVA_ATTIVAZIONE";
  if (t.includes("attiv")) return "ATTIVAZIONE";
  if (t.includes("cessaz") || t.includes("disdett")) return "CESSAZIONE";
  if (t.includes("rinnov")) return "RINNOVO";
  if (t.includes("altro")) return "ALTRO";
  if (t.includes("switch") || t.includes("cambio")) return "SWITCH";
  const upper = label.trim().toUpperCase().replace(/\s+/g, "_");
  return upper || "SWITCH";
}

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

/** Gettone effettivo allineato a quanto vedi in tabella. */
export function effectiveGettone(opts: {
  expected: number;
  clientType: string;
  supplierName: string;
}): number {
  const expected = Number(opts.expected) || 0;
  if (expected > 0) return expected;
  if (opts.clientType === "PRIVATO" || opts.clientType === "Domestico") {
    return defaultGettonePrivato(opts.supplierName) ?? 0;
  }
  return 0;
}

export function isRecurringMonthly(recurrence: string | null | undefined): boolean {
  const r = (recurrence ?? "").trim().toLowerCase();
  if (!r) return false;
  if (r === "r") return true;
  return r.includes("ricorr") || r.includes("mensil");
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
