/**
 * Badge ciclo storno / POD (P1.2) — mapping puro da segnali già calcolati.
 * Nessuna regola archivio/switch qui: solo etichette UI testo+icona.
 */

import type { StornoKind } from "@/lib/storno-status";

export type StornoBadgeId =
  | "in_storno"
  | "storno_in_scadenza"
  | "fuori_storno"
  | "doppia_posizione"
  | "storico"
  | "stornato";

export type StornoBadgeDef = {
  id: StornoBadgeId;
  label: string;
  /** Classi Tailwind sfondo + testo */
  className: string;
  /** Nome icona Lucide (risolta nel componente client) */
  icon: "shield" | "clock" | "check" | "layers" | "archive" | "undo";
};

export const STORNO_BADGE_DEFS: Record<StornoBadgeId, StornoBadgeDef> = {
  in_storno: {
    id: "in_storno",
    label: "In storno",
    className: "bg-red-100 text-red-900 ring-1 ring-red-300",
    icon: "shield",
  },
  storno_in_scadenza: {
    id: "storno_in_scadenza",
    label: "Storno in scadenza",
    className: "bg-violet-100 text-violet-900 ring-1 ring-violet-300",
    icon: "clock",
  },
  fuori_storno: {
    id: "fuori_storno",
    label: "Fuori storno",
    className: "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300",
    icon: "check",
  },
  doppia_posizione: {
    id: "doppia_posizione",
    label: "Doppia posizione",
    className: "bg-amber-100 text-amber-950 ring-1 ring-amber-300",
    icon: "layers",
  },
  storico: {
    id: "storico",
    label: "Storico",
    className: "bg-slate-200 text-slate-800 ring-1 ring-slate-400",
    icon: "archive",
  },
  stornato: {
    id: "stornato",
    label: "Stornato",
    className: "bg-rose-100 text-rose-900 ring-1 ring-rose-300",
    icon: "undo",
  },
};

/** Ordine di visualizzazione (più critico a sinistra). */
const BADGE_ORDER: StornoBadgeId[] = [
  "stornato",
  "in_storno",
  "storno_in_scadenza",
  "doppia_posizione",
  "storico",
  "fuori_storno",
];

export type ResolveStornoBadgesInput = {
  stornoKind?: StornoKind | null;
  /** Contratto archiviato (POD ricontrattualizzato, ecc.) */
  isHistorical?: boolean;
  /** Nuovo contratto mentre un precedente pagato è ancora in storno */
  isEarlyReswitch?: boolean;
  /** Status STORNATO o stato Provvigioni «Stornato» */
  isStornato?: boolean;
  /** Peer attivi sullo stesso POD (scheda dettaglio / anomalie) */
  hasActivePodPeer?: boolean;
};

/**
 * Restituisce i badge P1.2 applicabili (0..n).
 * Non emette badge per kind solo operativi (da_pagare, ricorrente, cessato, …).
 */
export function resolveStornoBadges(
  input: ResolveStornoBadgesInput,
): StornoBadgeDef[] {
  const ids = new Set<StornoBadgeId>();

  if (input.isHistorical) ids.add("storico");
  if (input.isStornato) ids.add("stornato");

  const kind = input.stornoKind ?? null;
  if (
    kind === "precedente" ||
    input.isEarlyReswitch === true ||
    input.hasActivePodPeer === true
  ) {
    ids.add("doppia_posizione");
  }

  if (kind === "in_storno") ids.add("in_storno");
  if (kind === "in_scadenza") ids.add("storno_in_scadenza");
  if (kind === "fuori_storno" && !input.isHistorical) ids.add("fuori_storno");

  return BADGE_ORDER.filter((id) => ids.has(id)).map(
    (id) => STORNO_BADGE_DEFS[id],
  );
}

/** Testo compatto per filtri / getValue colonna (badge labels uniti). */
export function stornoBadgesFilterText(badges: StornoBadgeDef[]): string {
  if (badges.length === 0) return "";
  return badges.map((b) => b.label).join(" · ");
}
