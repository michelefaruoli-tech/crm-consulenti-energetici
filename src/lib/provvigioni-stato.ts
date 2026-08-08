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
 * 3. Storno gettone applicato → Stornato (importo negativo nel Report Incassato)
 *
 * «Da controllare» = contratto inserito ma non ancora contrattualizzato:
 * va tenuto d’occhio e aggiornato appena possibile.
 *
 * Se non è ancora in fornitura → sempre «Da incassare»
 * (la data futura è attivazione prevista, non pagamento).
 */
export function simplifiedProvvigioneStato(
  status: string,
  hasCollectionDate: boolean,
  opts?: { inFornitura?: boolean; hasStorno?: boolean },
): string {
  // KO / cessato: ha priorità anche se c’è già una data di incasso (Helios).
  if (["KO", "ANNULLATO", "CHIUSO"].includes(status)) return "KO / Cessato";
  // Storno applicato e conteggiato (clawback)
  if (status === "STORNATO" || opts?.hasStorno) return "Stornato";
  // Inserito ma non contrattualizzato: priorità su fornitura/incasso
  if (status === "DA_CONTROLLARE") return "Da controllare";
  if (opts?.inFornitura === false) return "Da incassare";
  // Liquidazione collaboratore: deve avere priorità su "Incassato"
  if (status === "PROVVIGIONE_LIQUIDATA") return "Pagato";
  if (hasCollectionDate) return "Incassato";
  return "Da incassare";
}

export const PROVVIGIONE_STATO_OPTIONS = [
  "KO / Cessato",
  "Da controllare",
  "Da incassare",
  "Incassato",
  "Pagato",
  "Stornato",
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
 * Gestisce sia «Cognome Nome» sia «Nome Cognome» (molti utenti misti in anagrafe).
 */
const ITALIAN_FIRST_NAMES = new Set(
  [
    "alessandra",
    "alessandro",
    "andrea",
    "angela",
    "anna",
    "annarita",
    "antonella",
    "antonello",
    "antonio",
    "chiara",
    "claudia",
    "cristina",
    "daniela",
    "daniele",
    "davide",
    "elena",
    "elisa",
    "emanuele",
    "enrico",
    "erika",
    "fabiana",
    "fabio",
    "federica",
    "federico",
    "francesca",
    "francesco",
    "gabriel",
    "gabriele",
    "giada",
    "giorgia",
    "giorgio",
    "giovanna",
    "giovanni",
    "giulia",
    "giuseppe",
    "ilaria",
    "laura",
    "leonardo",
    "luca",
    "lucia",
    "lucius",
    "luigi",
    "marco",
    "maria",
    "marina",
    "mario",
    "marta",
    "martina",
    "massimo",
    "matteo",
    "mattia",
    "mauro",
    "michele",
    "nicola",
    "paolo",
    "pasquale",
    "patrizia",
    "pietro",
    "roberta",
    "roberto",
    "rosa",
    "salvatore",
    "sara",
    "serena",
    "silvia",
    "simona",
    "stefania",
    "stefano",
    "valentina",
    "valeria",
    "vincenzo",
    "vito",
  ].map((s) => s.toLowerCase()),
);

function normalizeNameToken(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function capitalizeWord(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatCollaboratorShort(fullName: string): string {
  const raw = fullName.trim().replace(/\s+/g, " ");
  if (!raw) return "";

  // Già abbreviato tipo «Giuseppe.m» / «Giuseppe.M.»
  const dotted = raw.match(/^([A-Za-zÀ-ÿ'’-]+)\.([A-Za-zÀ-ÿ])\.?$/u);
  if (dotted) {
    return `${capitalizeWord(dotted[1]!)} ${dotted[2]!.toUpperCase()}.`;
  }

  const parts = raw.split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0]!;

  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  const firstIsNome = ITALIAN_FIRST_NAMES.has(normalizeNameToken(first));
  const lastIsNome = ITALIAN_FIRST_NAMES.has(normalizeNameToken(last));

  let cognome: string;
  let nome: string;

  if (firstIsNome && !lastIsNome) {
    // «Francesco Giudice» → cognome Giudice, nome Francesco
    nome = first;
    cognome = parts.slice(1).join(" ");
  } else if (!firstIsNome && lastIsNome) {
    // «Fagiano Marco» / «Laforgia Vito»
    cognome = parts.slice(0, -1).join(" ");
    nome = last;
  } else {
    // Ambiguo o entrambi sconosciuti: convenzione CRM «Cognome Nome»
    cognome = first;
    nome = parts.slice(1).join(" ");
  }

  const iniziale = nome.charAt(0).toUpperCase();
  return iniziale ? `${cognome} ${iniziale}.` : cognome;
}
