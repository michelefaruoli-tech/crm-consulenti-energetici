/**
 * Stato storno / colori riga contratto.
 *
 * Regola di business (provvigioni energia):
 * - Contratto NON ancora pagato → FUORI STORNO («Da pagare»).
 * - Dopo il pagamento parte il periodo di storno del fornitore
 *   (data ingresso fornitura + mesi storno).
 * - «In storno» critico = RICAMBIO: nuovo contratto sullo stesso POD
 *   mentre un contratto precedente già pagato è ancora nel periodo storno.
 *
 * Priorità colori:
 * 1. grigio  — KO / Annullato / Chiuso
 * 2. rosso   — Ricambio in periodo storno / Scaduto
 * 3. ambra   — Periodo storno in scadenza (pagato, ultimi 30 gg)
 * 4. rosso chiaro — Pagato e ancora nel periodo storno (non ricambiare)
 * 5. salvia  — Ricorrente
 * 6. verde   — Da pagare / Fuori storno
 */

export type StornoKind =
  | "cessato"
  | "scaduto"
  | "in_storno"
  | "in_scadenza"
  | "ricorrente"
  | "fuori_storno"
  | "sconosciuto"
  | "precedente"
  | "da_pagare";

export type StornoInfo = {
  kind: StornoKind;
  label: string;
  /** Classi Tailwind per sfondo riga */
  rowClassName: string;
  stornoEndDate: Date | null;
  isFuoriStorno: boolean;
  /** true se modificare richiede avviso popup */
  warnOnEdit: boolean;
};

const CESSATI = new Set(["KO", "ANNULLATO", "CHIUSO"]);
/** Giorni prima della fine storno = “in scadenza” */
export const STORNO_WARNING_DAYS = 30;

export function normalizePodKey(podPdr: string | null | undefined): string {
  return String(podPdr ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function isRecurring(recurrence: string | null | undefined): boolean {
  return /ricor/i.test(String(recurrence ?? ""));
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // Gestione fine mese (es. 31 gen + 1 mese)
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

  if (CESSATI.has(input.status)) {
    return {
      kind: "cessato",
      label: "KO / Cessato",
      rowClassName: "bg-slate-200/80 text-slate-700",
      stornoEndDate: null,
      isFuoriStorno: false,
      warnOnEdit: false,
    };
  }

  if (input.isLatestForPod === false) {
    return {
      kind: "precedente",
      label: "Precedente (stesso POD)",
      rowClassName: "bg-slate-100/90 text-slate-500",
      stornoEndDate: null,
      isFuoriStorno: false,
      warnOnEdit: true,
    };
  }

  const stornoEnd = computeStornoEndDate(
    input.supplyStartDate,
    input.stornoMonths,
    input.stornoEndDate,
  );

  // Ricambio anticipato = vero rischio storno (anche se il nuovo non è ancora pagato)
  if (input.isEarlyReswitch) {
    return {
      kind: "in_storno",
      label: "Ricambio in periodo storno",
      rowClassName: "bg-red-50/90",
      stornoEndDate: stornoEnd,
      isFuoriStorno: false,
      warnOnEdit: true,
    };
  }

  // Non ancora pagato → fuori storno (nuovo da liquidare)
  if (!isPaid(input.collectionDate)) {
    return {
      kind: "da_pagare",
      label: "Da pagare",
      rowClassName: "bg-emerald-50/90",
      stornoEndDate: stornoEnd,
      isFuoriStorno: true,
      warnOnEdit: false,
    };
  }

  // 0 mesi = nessun periodo di storno dopo pagamento
  if (input.stornoMonths === 0) {
    return {
      kind: "fuori_storno",
      label: "Fuori storno (0 mesi)",
      rowClassName: "bg-emerald-50/90",
      stornoEndDate: input.supplyStartDate ?? null,
      isFuoriStorno: true,
      warnOnEdit: false,
    };
  }

  // Ricorrente: resta sempre verde salvia
  if (isRecurring(input.recurrence)) {
    return {
      kind: "ricorrente",
      label: "Ricorrente",
      rowClassName: "bg-teal-50/90",
      stornoEndDate: stornoEnd,
      isFuoriStorno: true,
      warnOnEdit: false,
    };
  }

  // Scaduto: oltre data scadenza o oltre durata contratto
  let expired = false;
  if (input.expiryDate) {
    expired = startOfDay(now) > startOfDay(input.expiryDate);
  } else if (input.supplyStartDate && input.durationMonths && input.durationMonths > 0) {
    const end = addMonths(input.supplyStartDate, input.durationMonths);
    expired = startOfDay(now) > startOfDay(end);
  }
  if (expired) {
    return {
      kind: "scaduto",
      label: "Scaduto",
      rowClassName: "bg-red-100/90",
      stornoEndDate: stornoEnd,
      isFuoriStorno: false,
      warnOnEdit: true,
    };
  }

  if (!stornoEnd) {
    return {
      kind: "fuori_storno",
      label: "Fuori storno",
      rowClassName: "bg-emerald-50/90",
      stornoEndDate: null,
      isFuoriStorno: true,
      warnOnEdit: false,
    };
  }

  const remaining = daysBetween(now, stornoEnd);

  if (remaining < 0) {
    return {
      kind: "fuori_storno",
      label: "Fuori storno",
      rowClassName: "bg-emerald-50/90",
      stornoEndDate: stornoEnd,
      isFuoriStorno: true,
      warnOnEdit: false,
    };
  }

  if (remaining <= STORNO_WARNING_DAYS) {
    return {
      kind: "in_scadenza",
      label: "Fine periodo storno",
      rowClassName: "bg-amber-100/90",
      stornoEndDate: stornoEnd,
      isFuoriStorno: false,
      warnOnEdit: true,
    };
  }

  // Pagato e ancora dentro i mesi di storno: non ricambiare
  return {
    kind: "in_storno",
    label: "In periodo storno (pagato)",
    rowClassName: "bg-red-50/90",
    stornoEndDate: stornoEnd,
    isFuoriStorno: false,
    warnOnEdit: true,
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
  { label: "Da pagare / Fuori storno", className: "bg-emerald-200 ring-emerald-300" },
  { label: "Ricorrente", className: "bg-teal-200 ring-teal-300" },
  { label: "Fine periodo storno", className: "bg-amber-200 ring-amber-300" },
  { label: "Periodo storno / Ricambio", className: "bg-red-200 ring-red-300" },
  { label: "KO / Cessato", className: "bg-slate-300 ring-slate-400" },
] as const;
