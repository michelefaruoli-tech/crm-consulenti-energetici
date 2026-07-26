/**
 * Stato storno / colori riga contratto (e lista clienti).
 *
 * Colori (richiesta UI):
 * - giallo       — Da incassare
 * - teal chiaro  — Ricorrente (distinto dal lime fuori storno)
 * - arancio      — A ~1 mese dai 2 mesi di contratto (inizio fornitura + 2 mesi)
 * - rosso chiaro — In periodo storno
 * - grigio       — KO / Cessato
 * - lime         — Fuori storno
 * - testo rosso  — A ~1 mese dalla fine storno
 */

import { isRecurring as isRecurringCanonical } from "@/lib/recurring";

export type StornoKind =
  | "cessato"
  | "scaduto"
  | "in_storno"
  | "in_scadenza"
  | "verso_due_mesi"
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
/** Giorni prima della fine storno = “in scadenza” (~1 mese) */
export const STORNO_WARNING_DAYS = 30;
/** Giorni prima del traguardo «2 mesi di contratto» */
export const TWO_MONTH_WARNING_DAYS = 30;

/**
 * Testo sempre scuro + link/select/input leggibili su sfondi colorati.
 * (Evita verde-su-verde / bianco-su-chiaro illeggibili)
 */
const ROW_TEXT =
  "text-slate-900 [&_a]:text-slate-900 [&_a]:font-semibold [&_a]:underline-offset-2 hover:[&_a]:underline [&_select]:bg-white [&_select]:text-slate-900 [&_input]:text-slate-900 [&_button]:opacity-100";

const ROW_TEXT_MUTED =
  "text-slate-700 [&_a]:text-slate-800 [&_a]:font-semibold [&_select]:bg-white [&_select]:text-slate-900 [&_input]:text-slate-800";

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

/**
 * Manca ~1 mese al compimento di 2 mesi dall’inizio fornitura
 * (finestra: 0–30 giorni prima di inizio+2 mesi).
 */
export function isApproachingTwoMonthsContract(
  supplyStart: Date | null | undefined,
  now = new Date(),
): boolean {
  if (!supplyStart) return false;
  const mark = addMonths(supplyStart, 2);
  const remaining = daysBetween(now, mark);
  return remaining >= 0 && remaining <= TWO_MONTH_WARNING_DAYS;
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
      rowClassName: `bg-slate-200 ${ROW_TEXT_MUTED}`,
      stornoEndDate: null,
      isFuoriStorno: false,
      warnOnEdit: false,
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
      rowClassName: `bg-red-100 ${ROW_TEXT}`,
      stornoEndDate: stornoEnd,
      isFuoriStorno: false,
      warnOnEdit: true,
    };
  }

  // ~1 mese prima dei 2 mesi di contratto (inizio fornitura + 2 mesi)
  if (isApproachingTwoMonthsContract(input.supplyStartDate, now)) {
    return {
      kind: "verso_due_mesi",
      label: "Verso 2 mesi (-1 mese)",
      rowClassName: `border-l-4 border-orange-500 bg-orange-100 ${ROW_TEXT}`,
      stornoEndDate: stornoEnd,
      isFuoriStorno: false,
      warnOnEdit: true,
    };
  }

  // Ricorrente: teal chiaro (non scuro), ben distinto dal lime «fuori storno»
  if (isRecurring(input.recurrence)) {
    return {
      kind: "ricorrente",
      label: "Ricorrente",
      rowClassName: `border-l-4 border-teal-500 bg-teal-50 ${ROW_TEXT}`,
      stornoEndDate: stornoEnd,
      isFuoriStorno: true,
      warnOnEdit: false,
    };
  }

  // Non ancora pagato → da incassare (giallo + testo scuro)
  if (!isPaid(input.collectionDate)) {
    return {
      kind: "da_pagare",
      label: "Da incassare",
      rowClassName: `bg-yellow-100 ${ROW_TEXT}`,
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
      rowClassName: `bg-lime-100 ${ROW_TEXT}`,
      stornoEndDate: input.supplyStartDate ?? null,
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
      rowClassName: `bg-red-100 ${ROW_TEXT}`,
      stornoEndDate: stornoEnd,
      isFuoriStorno: false,
      warnOnEdit: true,
    };
  }

  if (!stornoEnd) {
    return {
      kind: "fuori_storno",
      label: "Fuori storno",
      rowClassName: `bg-lime-100 ${ROW_TEXT}`,
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
      rowClassName: `bg-lime-100 ${ROW_TEXT}`,
      stornoEndDate: stornoEnd,
      isFuoriStorno: true,
      warnOnEdit: false,
    };
  }

  // ~1 mese dalla fine storno: evidenzia la scritta in rosso
  if (remaining <= STORNO_WARNING_DAYS) {
    return {
      kind: "in_scadenza",
      label: "Fine periodo storno (~1 mese)",
      rowClassName: `bg-rose-50 ${ROW_TEXT_ALERT}`,
      stornoEndDate: stornoEnd,
      isFuoriStorno: false,
      warnOnEdit: true,
    };
  }

  // Pagato e ancora dentro i mesi di storno: non ricambiare
  return {
    kind: "in_storno",
    label: "In periodo storno (pagato)",
    rowClassName: `bg-red-100 ${ROW_TEXT}`,
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
  { label: "Da incassare", className: "bg-yellow-200 ring-yellow-500" },
  { label: "Ricorrente", className: "bg-teal-50 ring-teal-500" },
  { label: "Fuori storno (si può cambiare)", className: "bg-lime-200 ring-lime-500" },
  { label: "Verso 2 mesi (-1)", className: "bg-orange-200 ring-orange-500" },
  { label: "Fine storno (~1 mese) — testo rosso", className: "bg-rose-100 ring-red-500" },
  { label: "In periodo storno (non cambiare)", className: "bg-red-200 ring-red-400" },
  { label: "KO / Cessato", className: "bg-slate-300 ring-slate-500" },
] as const;

/**
 * Priorità per scegliere il colore riga quando un cliente ha più contratti.
 * Numero più basso = più importante (vince).
 */
const CLIENT_KIND_PRIORITY: Record<StornoKind, number> = {
  in_storno: 1,
  scaduto: 2,
  in_scadenza: 3,
  verso_due_mesi: 4,
  da_pagare: 5,
  ricorrente: 6,
  fuori_storno: 7,
  precedente: 8,
  cessato: 9,
  sconosciuto: 10,
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
