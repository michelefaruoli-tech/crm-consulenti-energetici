/**
 * Tipi e helper Provvigioni usabili sia dal Server Component (page)
 * sia dal Client Component (tabella). Non mettere "use client" qui.
 */

import { isRecurring, isRecurringMonthly, periodLabel, toPeriod } from "@/lib/recurring";

export type ProvvigioneRow = {
  /** Chiave riga tabella (contratto o contratto:mese). */
  id: string;
  rowKey?: string;
  /** ID contratto originale (bulk action). */
  contractId?: string;
  /** Mese competenza YYYY-MM per clone ricorrente. */
  competencePeriod?: string;
  clientId: string;
  commissionId: string;
  clientName: string;
  podPdr: string;
  collaboratorName: string;
  supplierName: string;
  /** Chi paga il gettone (da fornitore) — vista avanzata */
  agency: string;
  clientType: string;
  /** Gettone effettivo mostrato in colonna Gettone */
  amount: string;
  /** Data inizio fornitura (gg/mm/aaaa) — vista avanzata */
  supplyStartDate: string;
  /** Etichetta tipo operazione (Switch, Voltura, …) */
  operationType: string;
  recurrence: string;
  /** Stato semplificato: KO / Cessato | Da incassare | Incassato da liquidare | Liquidato */
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
 * Ciclo (P1.1 B1) — INCASSATO ≠ LIQUIDATO:
 * 1. Atteso / da incassare → fornitore non ha ancora pagato
 * 2. Incassato da liquidare → fornitore ha pagato (collectionDate / rate PAID)
 * 3. Liquidato → liquidato al collaboratore (PROVVIGIONE_LIQUIDATA / LIQUIDATED)
 * 4. Storno gettone applicato → Stornato
 *
 * Alias URL/filtro retrocompatibili: `stato=Incassato` ≡ «Incassato da liquidare»,
 * `stato=Pagato` ≡ «Liquidato» (vedi canonicalizeProvvigioneStato).
 *
 * «Da controllare» = contratto inserito ma non ancora contrattualizzato.
 * Se non è ancora in fornitura → sempre «Da incassare».
 */
export function simplifiedProvvigioneStato(
  status: string,
  hasCollectionDate: boolean,
  opts?: { inFornitura?: boolean; hasStorno?: boolean },
): string {
  // KO / cessato: ha priorità anche se c’è già una data di incasso (Helios).
  if (["KO", "ANNULLATO", "CHIUSO"].includes(status)) return "KO / Cessato";
  // Recuperato: solo se lo stato è Stornato (Storno Sì da solo = ancora da applicare)
  if (status === "STORNATO") return "Stornato";
  if (status === "DA_CONTROLLARE") return "Da controllare";
  if (status === "IN_ATTESA_PAGAMENTO") return "Da incassare";
  if (status === "PROVVIGIONE_LIQUIDATA") return "Liquidato";
  if (hasCollectionDate) return "Incassato da liquidare";
  if (opts?.inFornitura === false) return "Da incassare";
  return "Da incassare";
}

/** Etichette UI del ciclo (filtri, card, colonna Stato). */
export const PROVVIGIONE_STATO_OPTIONS = [
  "KO / Cessato",
  "Da controllare",
  "Da incassare",
  "Incassato da liquidare",
  "Liquidato",
  "Stornato",
] as const;

/**
 * Chiave canonica usata dai filtri Prisma / report (stabile, senza migrazione DB).
 * «Incassato» = coda da liquidare; «Pagato» = liquidato al collaboratore.
 */
export function canonicalizeProvvigioneStato(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  if (s === "Incassato da liquidare" || s === "Incassato") return "Incassato";
  if (s === "Liquidato" || s === "Pagato") return "Pagato";
  return s;
}

/** Etichetta UI a partire da chiave canonica o alias URL. */
export function displayProvvigioneStato(raw: string): string {
  const c = canonicalizeProvvigioneStato(raw);
  if (c === "Incassato") return "Incassato da liquidare";
  if (c === "Pagato") return "Liquidato";
  return c;
}

/**
 * Interpreta etichetta UI (nuova o alias) per marcatura cella/bulk.
 * Non confondere «Incassato da liquidare» con «Liquidato».
 */
export function provvigioneStatoActionKind(
  label: string,
): "ko" | "controllare" | "stornato" | "liquidato" | "incassato" | "da-incassare" {
  const raw = label.trim().toLowerCase();
  if (/ko|cessat|annull|chius/.test(raw)) return "ko";
  if (/controll/.test(raw)) return "controllare";
  if (/^storn/.test(raw)) return "stornato";
  // Liquidato al collaboratore (alias: Pagato). Esclude «Incassato da liquidare».
  if (
    raw === "liquidato" ||
    raw === "pagato" ||
    (/liquidat/.test(raw) && !/incass/.test(raw)) ||
    (/pagat/.test(raw) && !/incass/.test(raw))
  ) {
    return "liquidato";
  }
  if (/incass/.test(raw) && !/da\s*incass/.test(raw)) return "incassato";
  return "da-incassare";
}

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

/**
 * Agenzia pagatrice del gettone (vista avanzata Provvigioni).
 * Usa il valore salvato sul contratto se presente, altrimenti deriva dal fornitore.
 */
export const PROVVIGIONE_AGENCY_OPTIONS = [
  "COMPARA",
  "MADA",
  "Achille",
  "BROKER",
  "POWER",
  "HELIOS",
] as const;

export function agencyFromSupplierName(supplierName: string): string {
  const n = supplierName.toLowerCase().replace(/\s+/g, "");
  if (n.includes("iren") || n.includes("plenitud") || n.includes("enipro")) {
    return "COMPARA";
  }
  if (n.includes("edison") || n.includes("dolomit")) return "MADA";
  if (n.includes("enel")) return "Achille";
  if (n.includes("sinerg") || n.includes("etruri")) return "BROKER";
  if (n.includes("sorgenia") || n.includes("a2a")) return "POWER";
  if (n.includes("helios")) return "HELIOS";
  return "—";
}

export function provvigioneAgencyLabel(
  supplierName: string,
  storedAgency?: string | null,
): string {
  const stored = String(storedAgency ?? "").trim();
  if (stored) return stored;
  return agencyFromSupplierName(supplierName);
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

type RecurringMonthAmount = {
  period: string;
  amount: { toString(): string } | null;
};

/** Importo colonna Gettone (tabella + card): rata del mese competenza o gettone. */
export function provvigioneDisplayAmount(opts: {
  commissionExpected: number;
  clientType: string;
  supplierName: string;
  recurringMonths?: RecurringMonthAmount[];
  competencePeriod?: string | null;
}): number {
  const competence = opts.competencePeriod?.trim();
  if (competence && opts.recurringMonths?.length) {
    const row = opts.recurringMonths.find((m) => m.period === competence);
    if (row?.amount != null) {
      const monthAmount = Number(row.amount.toString());
      if (monthAmount > 0) return monthAmount;
    }
  }
  return effectiveGettone({
    expected: opts.commissionExpected,
    clientType: opts.clientType,
    supplierName: opts.supplierName,
  });
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
  const tag = last.status === "LIQUIDATED" ? "liquidato" : "incassato";
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
