/**
 * Tipi e helper Provvigioni usabili sia dal Server Component (page)
 * sia dal Client Component (tabella). Non mettere "use client" qui.
 */

import { isRecurring, isRecurringMonthly, periodLabel, toPeriod } from "@/lib/recurring";

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
  /** Data inizio fornitura (gg/mm/aaaa) — vista avanzata */
  supplyStartDate: string;
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
  /** Manca data ingresso fornitura → POD/link in rosso */
  missingSupplyStart?: boolean;
  /** Solo ricorrenti: ultima competenza mensile (sotto colonna Incasso) */
  recurringIncassoNote?: string;
};

/**
 * Stato in Provvigioni (UI semplificata).
 *
 * Flusso atteso:
 * 1. Rendiconto fornitore (import Helios, ecc.) → Incassato (collectionDate)
 * 2. Liquidazione collaboratore (Segna pagato) → Pagato (PROVVIGIONE_LIQUIDATA)
 *
 * Se non è ancora in fornitura → sempre «Da incassare»
 * (la data futura è attivazione prevista, non pagamento).
 */
export function simplifiedProvvigioneStato(
  status: string,
  hasCollectionDate: boolean,
  opts?: { inFornitura?: boolean },
): string {
  // KO / cessato: ha priorità anche se c’è già una data di incasso (Helios).
  if (["KO", "ANNULLATO", "CHIUSO"].includes(status)) return "KO / Cessato";
  if (opts?.inFornitura === false) return "Da incassare";
  // Liquidazione collaboratore: deve avere priorità su "Incassato"
  if (status === "PROVVIGIONE_LIQUIDATA") return "Pagato";
  if (hasCollectionDate) return "Incassato";
  return "Da incassare";
}

export const PROVVIGIONE_STATO_OPTIONS = [
  "KO / Cessato",
  "Da incassare",
  "Incassato",
  "Pagato",
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

export { isRecurringMonthly };

/** Ultima competenza pagata (Incassato o Pagato) — sempre utile in tabella. */
export function lastRecurringPaidNote(
  months: Array<{ period: string; status: string }>,
): string {
  if (months.length === 0) return "";
  const paid = [...months]
    .filter((m) => m.status === "PAID" || m.status === "LIQUIDATED")
    .sort((a, b) => a.period.localeCompare(b.period));
  if (paid.length === 0) return "";
  const last = paid[paid.length - 1]!;
  const tag = last.status === "LIQUIDATED" ? "pagato" : "incassato";
  return `ultimo mese ${tag}: ${periodLabel(last.period)}`;
}

/**
 * Nota sotto «Incasso» / Data pagato per i ricorrenti.
 * Mostra sempre l’ultimo mese pagato; se ci sono ritardi, aggiunge «da incassare».
 */
export function lastRecurringIncassoNote(
  months: Array<{ period: string; status: string }>,
  _statoSemplificato?: string,
): string {
  if (months.length === 0) return "";

  const now = toPeriod(new Date());
  const sorted = [...months].sort((a, b) => a.period.localeCompare(b.period));
  const parts: string[] = [];

  const lastPaid = lastRecurringPaidNote(sorted);
  if (lastPaid) parts.push(lastPaid);

  const pastMissing = sorted.filter(
    (m) => m.status === "MISSING" && m.period < now,
  );
  if (pastMissing.length > 0) {
    const last = pastMissing[pastMissing.length - 1]!;
    parts.push(
      pastMissing.length === 1
        ? `${periodLabel(last.period)} da incassare`
        : `${pastMissing.length} mesi da incassare (fino a ${periodLabel(last.period)})`,
    );
  }

  return parts.join(" · ");
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
