/**
 * Stato storno / colori riga contratto (e lista clienti).
 *
 * Palette richiesta (nettamente distinguibili):
 * 1. giallo/ambra  — Da incassare
 * 2. rosso         — Periodo storno NON finito → NON TOCCARE (blocco)
 * 3. verde smeraldo — Fuori storno (si può ricontrattualizzare)
 * 4. ciano         — Ricorrente a vita
 * 5. viola + testo rosso — Prossimo alla fine storno (~1 mese)
 * 6. arancio + testo rosso — Prossimo/scaduto contratto (12 mesi)
 * + grigio         — KO / Cessato
 * + POD in rosso   — Manca data ingresso fornitura (da sistemare)
 */

import { isRecurring as isRecurringCanonical } from "@/lib/recurring";
import { isInFornitura } from "@/lib/supply-dates";

export type StornoKind =
  | "cessato"
  | "scaduto"
  | "scadenza_contratto"
  | "in_storno"
  | "in_scadenza"
  | "ricorrente"
  | "fuori_storno"
  | "sconosciuto"
  | "precedente"
  | "da_pagare"
  | "manca_ingresso"
  /** @deprecated sostituito da scadenza_contratto */
  | "verso_due_mesi";

export type StornoInfo = {
  kind: StornoKind;
  label: string;
  /** Classi Tailwind per sfondo riga */
  rowClassName: string;
  stornoEndDate: Date | null;
  isFuoriStorno: boolean;
  /** true se modificare richiede avviso popup */
  warnOnEdit: boolean;
  /** Manca data inizio fornitura → evidenzia POD in rosso */
  missingSupplyStart?: boolean;
};

const CESSATI = new Set(["KO", "ANNULLATO", "CHIUSO"]);
/** Giorni prima della fine storno = “in scadenza” (~1 mese) */
export const STORNO_WARNING_DAYS = 30;
/** Giorni prima della scadenza contrattuale (12 mesi) */
export const CONTRACT_EXPIRY_WARNING_DAYS = 30;

/**
 * Testo sempre scuro + link/select/input leggibili su sfondi colorati.
 */
const ROW_TEXT =
  "text-slate-900 [&_a]:text-slate-900 [&_a]:font-semibold [&_a]:underline-offset-2 hover:[&_a]:underline [&_select]:bg-white [&_select]:text-slate-900 [&_input]:text-slate-900 [&_button]:opacity-100";

const ROW_TEXT_MUTED =
  "text-slate-700 [&_a]:text-slate-800 [&_a]:font-semibold [&_select]:bg-white [&_select]:text-slate-900 [&_input]:text-slate-800";

/** Scritte rosse su arancio/viola (scadenze) */
const ROW_TEXT_ALERT =
  "font-semibold text-red-800 [&_a]:font-bold [&_a]:text-red-800 [&_select]:bg-white [&_select]:text-slate-900 [&_input]:text-red-800";

export function normalizePodKey(podPdr: string | null | undefined): string {
  return String(podPdr ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function isRecurring(recurrence: string | null | undefined): boolean {
  return isRecurringCanonical(recurrence);
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0);
  return d;
}

export function computeStornoEndDate(
  supplyStart: Date | null | undefined,
  stornoMonths: number | null | undefined,
  storedStornoEnd?: Date | null,
): Date | null {
  if (supplyStart && stornoMonths != null && stornoMonths > 0) {
    return addMonths(supplyStart, stornoMonths);
  }
  return storedStornoEnd ?? null;
}

/** Fine contratto: expiryDate oppure ingresso + durata (default 12 mesi). */
export function computeContractEndDate(
  supplyStart: Date | null | undefined,
  durationMonths: number | null | undefined,
  expiryDate?: Date | null,
): Date | null {
  if (expiryDate) return expiryDate;
  if (!supplyStart) return null;
  const months =
    durationMonths != null && durationMonths > 0 ? durationMonths : 12;
  return addMonths(supplyStart, months);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetween(from: Date, to: Date): number {
  const ms = startOfDay(to).getTime() - startOfDay(from).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

function isPaid(collectionDate: Date | null | undefined): boolean {
  return Boolean(collectionDate);
}

/**
 * Incasso “effettivo” per colori/stato: se non è ancora in fornitura,
 * una collectionDate futura (spesso = attivazione prevista) NON conta come pagamento.
 */
export function effectiveCollectionDate(
  collectionDate: Date | null | undefined,
  supplyStartDate: Date | null | undefined,
  now: Date = new Date(),
): Date | null {
  if (!collectionDate) return null;
  if (!isInFornitura(supplyStartDate, now)) return null;
  return collectionDate;
}

export function resolveStornoInfo(input: {
  status: string;
  recurrence?: string | null;
  supplyStartDate?: Date | null;
  stornoMonths?: number | null;
  stornoEndDate?: Date | null;
  expiryDate?: Date | null;
  durationMonths?: number | null;
  /** Se false: stesso POD, non è il contratto più recente */
  isLatestForPod?: boolean;
  /** Data incasso / pagamento gettone (se assente = ancora da pagare) */
  collectionDate?: Date | null;
  /**
   * Nuovo contratto sullo stesso POD mentre un precedente già pagato
   * è ancora dentro i mesi di storno del fornitore.
   */
  isEarlyReswitch?: boolean;
  now?: Date;
}): StornoInfo {
  const now = input.now ?? new Date();
  const missingSupply = !input.supplyStartDate;
  const inFornitura = isInFornitura(input.supplyStartDate, now);
  const paidCollection = effectiveCollectionDate(
    input.collectionDate,
    input.supplyStartDate,
    now,
  );

  if (CESSATI.has(input.status)) {
    return {
      kind: "cessato",
      label: "KO / Cessato",
      rowClassName: `bg-slate-300 ${ROW_TEXT_MUTED}`,
      stornoEndDate: null,
      isFuoriStorno: false,
      warnOnEdit: false,
      missingSupplyStart: missingSupply,
    };
  }

  if (input.isLatestForPod === false) {
    return {
      kind: "precedente",
      label: "Precedente (stesso POD)",
      rowClassName: `bg-slate-100 ${ROW_TEXT_MUTED}`,
      stornoEndDate: null,
      isFuoriStorno: false,
      warnOnEdit: true,
      missingSupplyStart: missingSupply,
    };
  }

  const stornoEnd = computeStornoEndDate(
    input.supplyStartDate,
    input.stornoMonths,
    input.stornoEndDate,
  );
  const contractEnd = computeContractEndDate(
    input.supplyStartDate,
    input.durationMonths,
    input.expiryDate,
  );

  // Ricambio anticipato = rischio storno → blocco rosso
  if (input.isEarlyReswitch) {
    return {
      kind: "in_storno",
      label: "BLOCCA — ricambio in periodo storno",
      rowClassName: `border-l-4 border-red-700 bg-red-200 ${ROW_TEXT}`,
      stornoEndDate: stornoEnd,
      isFuoriStorno: false,
      warnOnEdit: true,
      missingSupplyStart: missingSupply,
    };
  }

  // Manca ingresso fornitura → da sistemare (POD in rosso in tabella)
  if (missingSupply) {
    return {
      kind: "manca_ingresso",
      label: "Manca data ingresso fornitura",
      rowClassName: `border-l-4 border-red-600 bg-white ${ROW_TEXT_ALERT}`,
      stornoEndDate: stornoEnd,
      isFuoriStorno: false,
      warnOnEdit: true,
      missingSupplyStart: true,
    };
  }

  // Non ancora in fornitura → giallo «Da incassare»
  // (anche se c’è collectionDate / Pagato in DB: spesso è attivazione prevista)
  if (!inFornitura) {
    return {
      kind: "da_pagare",
      label: "Da incassare (non ancora in fornitura)",
      rowClassName: `border-l-4 border-amber-500 bg-amber-100 ${ROW_TEXT}`,
      stornoEndDate: stornoEnd,
      isFuoriStorno: true,
      warnOnEdit: false,
      missingSupplyStart: false,
    };
  }

  // 4 — Ricorrente a vita (sempre distinguibile)
  if (isRecurring(input.recurrence)) {
    return {
      kind: "ricorrente",
      label: "Ricorrente a vita",
      rowClassName: `border-l-4 border-cyan-600 bg-cyan-100 ${ROW_TEXT}`,
      stornoEndDate: stornoEnd,
      isFuoriStorno: true,
      warnOnEdit: false,
      missingSupplyStart: missingSupply,
    };
  }

  // 1 — Da incassare (in fornitura ma senza incasso reale)
  if (!isPaid(paidCollection)) {
    return {
      kind: "da_pagare",
      label: "Da incassare",
      rowClassName: `border-l-4 border-amber-500 bg-amber-100 ${ROW_TEXT}`,
      stornoEndDate: stornoEnd,
      isFuoriStorno: true,
      warnOnEdit: false,
      missingSupplyStart: false,
    };
  }

  // 0 mesi storno → subito fuori storno (verde, NON rosso)
  if (input.stornoMonths === 0) {
    // ancora può essere vicino/scaduto il contratto 12 mesi
  } else if (stornoEnd) {
    const remainingStorno = daysBetween(now, stornoEnd);
    if (remainingStorno >= 0) {
      // 5 — Prossimo fine storno (~1 mese)
      if (remainingStorno <= STORNO_WARNING_DAYS) {
        return {
          kind: "in_scadenza",
          label: "Prossimo fine storno (~1 mese)",
          rowClassName: `border-l-4 border-violet-600 bg-violet-100 ${ROW_TEXT_ALERT}`,
          stornoEndDate: stornoEnd,
          isFuoriStorno: false,
          warnOnEdit: true,
          missingSupplyStart: false,
        };
      }
      // 2 — In periodo storno → ROSSO BLOCCA (priorità su scadenza 12 mesi)
      return {
        kind: "in_storno",
        label: "BLOCCA — storno non terminato",
        rowClassName: `border-l-4 border-red-700 bg-red-200 ${ROW_TEXT}`,
        stornoEndDate: stornoEnd,
        isFuoriStorno: false,
        warnOnEdit: true,
        missingSupplyStart: false,
      };
    }
  }

  // 6 — Scadenza / scaduto contratto (12 mesi) → arancio + scritta rossa
  //    Solo quando NON siamo più in storno (altrimenti resta il rosso blocco)
  if (contractEnd) {
    const daysToEnd = daysBetween(now, contractEnd);
    if (daysToEnd < 0) {
      return {
        kind: "scaduto",
        label: "Contratto scaduto (12 mesi)",
        rowClassName: `border-l-4 border-orange-600 bg-orange-200 ${ROW_TEXT_ALERT}`,
        stornoEndDate: stornoEnd,
        isFuoriStorno: true,
        warnOnEdit: true,
        missingSupplyStart: false,
      };
    }
    if (daysToEnd <= CONTRACT_EXPIRY_WARNING_DAYS) {
      return {
        kind: "scadenza_contratto",
        label: "Prossimo scadenza contratto (~1 mese)",
        rowClassName: `border-l-4 border-orange-500 bg-orange-100 ${ROW_TEXT_ALERT}`,
        stornoEndDate: stornoEnd,
        isFuoriStorno: true,
        warnOnEdit: true,
        missingSupplyStart: false,
      };
    }
  }

  // 3 — Fuori storno (verde smeraldo, diverso dal rosso)
  return {
    kind: "fuori_storno",
    label: input.stornoMonths === 0 ? "Fuori storno (0 mesi)" : "Fuori storno",
    rowClassName: `border-l-4 border-emerald-600 bg-emerald-100 ${ROW_TEXT}`,
    stornoEndDate: stornoEnd ?? (input.stornoMonths === 0 ? input.supplyStartDate ?? null : null),
    isFuoriStorno: true,
    warnOnEdit: false,
    missingSupplyStart: false,
  };
}

/** Chiavi cliente+fornitore+POD → id contratto più recente (utenze diverse restano indipendenti). */
export function markLatestContractsByPod<
  T extends {
    id: string;
    clientId: string;
    supplierId?: string | null;
    podPdr?: string | null;
    supplyStartDate?: Date | null;
    insertionDate?: Date | null;
    createdAt?: Date | null;
  },
>(contracts: T[]): Map<string, boolean> {
  const best = new Map<string, { id: string; score: number }>();

  for (const c of contracts) {
    const pod = normalizePodKey(c.podPdr);
    if (!pod) continue;
    const supplier = c.supplierId || "";
    const key = `${c.clientId}::${supplier}::${pod}`;
    const supply = c.supplyStartDate?.getTime() ?? 0;
    const insert = c.insertionDate?.getTime() ?? 0;
    const created = c.createdAt?.getTime() ?? 0;
    const score = supply * 1e6 + insert * 1e3 + created;
    const prev = best.get(key);
    if (!prev || score > prev.score) best.set(key, { id: c.id, score });
  }

  const latestIds = new Set([...best.values()].map((b) => b.id));
  const map = new Map<string, boolean>();
  for (const c of contracts) {
    const pod = normalizePodKey(c.podPdr);
    if (!pod) {
      map.set(c.id, true);
      continue;
    }
    map.set(c.id, latestIds.has(c.id));
  }
  return map;
}

/**
 * Segna i contratti che sono un ricambio sullo stesso POD mentre
 * un contratto precedente già pagato è ancora nel periodo storno.
 */
export function markEarlyReswitchContracts<
  T extends {
    id: string;
    clientId: string;
    supplierId?: string | null;
    podPdr?: string | null;
    supplyStartDate?: Date | null;
    insertionDate?: Date | null;
    createdAt?: Date | null;
    collectionDate?: Date | null;
    stornoMonths?: number | null;
    stornoEndDate?: Date | null;
  },
>(contracts: T[], now = new Date()): Map<string, boolean> {
  type Scored = T & { key: string; score: number; stornoEnd: Date | null };

  const scored: Scored[] = [];
  for (const c of contracts) {
    const pod = normalizePodKey(c.podPdr);
    if (!pod) continue;
    const supply = c.supplyStartDate?.getTime() ?? 0;
    const insert = c.insertionDate?.getTime() ?? 0;
    const created = c.createdAt?.getTime() ?? 0;
    scored.push({
      ...c,
      key: `${c.clientId}::${c.supplierId || ""}::${pod}`,
      score: supply * 1e6 + insert * 1e3 + created,
      stornoEnd: computeStornoEndDate(c.supplyStartDate, c.stornoMonths, c.stornoEndDate),
    });
  }

  const byKey = new Map<string, Scored[]>();
  for (const s of scored) {
    const list = byKey.get(s.key) ?? [];
    list.push(s);
    byKey.set(s.key, list);
  }

  const map = new Map<string, boolean>();
  for (const c of contracts) map.set(c.id, false);

  for (const list of byKey.values()) {
    const sorted = [...list].sort((a, b) => a.score - b.score);
    for (let i = 0; i < sorted.length; i++) {
      const curr = sorted[i];
      const earlierPaidInStorno = sorted.slice(0, i).some((prev) => {
        if (!prev.collectionDate) return false;
        if (!prev.stornoEnd) return false;
        return startOfDay(now) <= startOfDay(prev.stornoEnd);
      });
      if (earlierPaidInStorno) map.set(curr.id, true);
    }
  }

  return map;
}

export const STORNO_LEGEND = [
  { label: "1 Da incassare", className: "bg-amber-200 ring-amber-500" },
  { label: "2 BLOCCA storno (non toccare)", className: "bg-red-200 ring-red-700" },
  { label: "3 Fuori storno", className: "bg-emerald-200 ring-emerald-600" },
  { label: "4 Ricorrente a vita", className: "bg-cyan-200 ring-cyan-600" },
  { label: "5 Fine storno vicina", className: "bg-violet-200 ring-violet-600" },
  { label: "6 Scadenza contratto 12 mesi", className: "bg-orange-200 ring-orange-600" },
  { label: "Manca ingresso → POD rosso", className: "bg-white ring-red-600" },
  { label: "KO / Cessato", className: "bg-slate-300 ring-slate-500" },
] as const;

/**
 * Priorità per scegliere il colore riga quando un cliente ha più contratti.
 * Numero più basso = più importante (vince).
 */
const CLIENT_KIND_PRIORITY: Record<StornoKind, number> = {
  in_storno: 1,
  manca_ingresso: 2,
  scaduto: 3,
  scadenza_contratto: 4,
  in_scadenza: 5,
  verso_due_mesi: 6,
  da_pagare: 7,
  ricorrente: 8,
  fuori_storno: 9,
  precedente: 10,
  cessato: 11,
  sconosciuto: 12,
};

/** Aggrega lo stato storno dei contratti di un cliente in un solo stile riga. */
export function resolveClientRowStyle(
  infos: Array<Pick<StornoInfo, "kind" | "rowClassName" | "label">>,
): { kind: StornoKind; rowClassName: string; label: string } {
  if (infos.length === 0) {
    return { kind: "sconosciuto", rowClassName: "", label: "" };
  }
  let best = infos[0];
  let bestP = CLIENT_KIND_PRIORITY[best.kind] ?? 99;
  for (let i = 1; i < infos.length; i++) {
    const p = CLIENT_KIND_PRIORITY[infos[i].kind] ?? 99;
    if (p < bestP) {
      best = infos[i];
      bestP = p;
    }
  }
  return {
    kind: best.kind,
    rowClassName: best.rowClassName,
    label: best.label,
  };
}
