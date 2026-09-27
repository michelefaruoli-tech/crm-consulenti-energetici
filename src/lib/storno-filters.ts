/**
 * P1.2 B4 — filtri rapidi stato storno (Contratti / Provvigioni).
 * Where Prisma allineato ai badge B1; `now` sempre dal caller.
 * Non modifica regole archivio / switch / Helios.
 */

import type { Prisma } from "@/generated/prisma/client";
import {
  FILTER_LIST_SEP,
  formatFilterList,
  parseFilterList,
} from "@/lib/filter-list";
import {
  STORNO_BADGE_DEFS,
  type StornoBadgeId,
} from "@/lib/storno-badges";
import {
  normalizePodKey,
  STORNO_WARNING_DAYS,
} from "@/lib/storno-status";

/** Parametro URL condivisibile (`?storno=in_storno|storico`). */
export const STORNO_FILTER_PARAM = "storno";

/** Ordine chip = ordine legenda / badge B1. */
export const STORNO_FILTER_IDS: StornoBadgeId[] = [
  "in_storno",
  "storno_in_scadenza",
  "fuori_storno",
  "doppia_posizione",
  "storico",
  "stornato",
];

const FILTER_ID_SET = new Set<string>(STORNO_FILTER_IDS);

/** Allineato a `KO_STATUSES` in provvigioni-filters (no import ciclico). */
const KO_STATUSES_LOCAL = ["KO", "ANNULLATO", "CHIUSO"] as const;
const ACTIVE_NOT_IN = [...KO_STATUSES_LOCAL, "STORNATO"] as const;

export type StornoFilterOption = {
  id: StornoBadgeId;
  label: string;
};

export const STORNO_FILTER_OPTIONS: StornoFilterOption[] =
  STORNO_FILTER_IDS.map((id) => ({
    id,
    label: STORNO_BADGE_DEFS[id].label,
  }));

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + days);
  return x;
}

function normalizeFilterToken(raw: string): string {
  return raw
    .trim()
    .replace(/\+/g, " ")
    .replace(/-/g, "_")
    .replace(/\s+/g, "_")
    .toLowerCase();
}

/** Alias URL → id badge (es. `in-scadenza`, `pod-ricontrattualizzato`). */
const FILTER_ALIASES: Record<string, StornoBadgeId> = {
  in_storno: "in_storno",
  storno_in_scadenza: "storno_in_scadenza",
  in_scadenza: "storno_in_scadenza",
  fuori_storno: "fuori_storno",
  doppia_posizione: "doppia_posizione",
  doppia: "doppia_posizione",
  storico: "storico",
  pod_ricontrattualizzato: "storico",
  stornato: "stornato",
};

/**
 * Parse `?storno=` (separatore `|`). Valori sconosciuti ignorati.
 */
export function parseStornoStatusFilters(
  raw: string | null | undefined,
): StornoBadgeId[] {
  const out: StornoBadgeId[] = [];
  for (const part of parseFilterList(raw)) {
    const token = normalizeFilterToken(part);
    const id = FILTER_ALIASES[token];
    if (!id || !FILTER_ID_SET.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

export function formatStornoStatusFilters(
  ids: StornoBadgeId[],
): string | null {
  const cleaned = STORNO_FILTER_IDS.filter((id) => ids.includes(id));
  return formatFilterList(cleaned);
}

export function toggleStornoStatusFilter(
  selected: StornoBadgeId[],
  id: StornoBadgeId,
): StornoBadgeId[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  return STORNO_FILTER_IDS.filter((x) => x === id || selected.includes(x));
}

/**
 * Legacy Provvigioni `focus=fuori-storno` → stesso filtro di `storno=fuori_storno`.
 */
export function mergeLegacyFuoriStornoFocus(
  ids: StornoBadgeId[],
  focus: string | null | undefined,
): StornoBadgeId[] {
  const n = (focus ?? "")
    .trim()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-")
    .toLowerCase();
  if (n !== "fuori-storno") return ids;
  if (ids.includes("fuori_storno")) return ids;
  return toggleStornoStatusFilter(ids, "fuori_storno");
}

export function stornoFilterNeedsDoppiaIds(ids: StornoBadgeId[]): boolean {
  return ids.includes("doppia_posizione");
}

/** Con filtro Storico non forzare `isHistorical: false` sulla base. */
export function stornoFilterAllowsHistorical(ids: StornoBadgeId[]): boolean {
  return ids.includes("storico");
}

/**
 * Periodo storno ancora lungo (> 30 giorni). Usa `stornoEndDate` (come focus fuori storno).
 */
export function inStornoWhere(now: Date): Prisma.ContractWhereInput {
  const today = startOfDay(now);
  const afterWarning = addDays(today, STORNO_WARNING_DAYS);
  return {
    status: { notIn: [...ACTIVE_NOT_IN] },
    isHistorical: false,
    collectionDate: { not: null },
    supplyStartDate: { lte: today },
    stornoEndDate: { gt: afterWarning },
  };
}

/** Fine storno entro 30 giorni (inclusi oggi e giorno fine). */
export function stornoInScadenzaWhere(now: Date): Prisma.ContractWhereInput {
  const today = startOfDay(now);
  const deadline = addDays(today, STORNO_WARNING_DAYS);
  return {
    status: { notIn: [...ACTIVE_NOT_IN] },
    isHistorical: false,
    collectionDate: { not: null },
    supplyStartDate: { lte: today },
    stornoEndDate: { gte: today, lte: deadline },
  };
}

/**
 * Stesso segnale del focus legacy `fuori-storno` + non storico.
 * (Badge B1 «Fuori storno» è più stretto: qui coerenti col filtro già in prod.)
 */
export function fuoriStornoFilterWhere(now: Date): Prisma.ContractWhereInput {
  return {
    AND: [
      {
        status: { notIn: ["KO", "ANNULLATO", "CHIUSO", "STORNATO"] },
        OR: [
          { stornoEndDate: { lte: now } },
          { supplier: { stornoMonths: 0 } },
        ],
      },
      { isHistorical: false },
    ],
  };
}

export function storicoWhere(): Prisma.ContractWhereInput {
  return { isHistorical: true };
}

/** Status STORNATO oppure clawback con data storno in Commission. */
export function stornatoFilterWhere(): Prisma.ContractWhereInput {
  return {
    OR: [
      { status: "STORNATO" },
      { commission: { stornoDate: { not: null } } },
    ],
  };
}

export function doppiaPosizioneIdsWhere(
  ids: string[],
): Prisma.ContractWhereInput {
  return { id: { in: ids } };
}

/**
 * OR tra i filtri selezionati. `doppiaIds` richiesto se c’è `doppia_posizione`.
 */
export function buildStornoStatusWhere(
  ids: StornoBadgeId[],
  opts: { now: Date; doppiaIds?: string[] },
): Prisma.ContractWhereInput | undefined {
  if (ids.length === 0) return undefined;

  const ors: Prisma.ContractWhereInput[] = [];
  for (const id of ids) {
    switch (id) {
      case "in_storno":
        ors.push(inStornoWhere(opts.now));
        break;
      case "storno_in_scadenza":
        ors.push(stornoInScadenzaWhere(opts.now));
        break;
      case "fuori_storno":
        ors.push(fuoriStornoFilterWhere(opts.now));
        break;
      case "doppia_posizione":
        ors.push(doppiaPosizioneIdsWhere(opts.doppiaIds ?? []));
        break;
      case "storico":
        ors.push(storicoWhere());
        break;
      case "stornato":
        ors.push(stornatoFilterWhere());
        break;
      default:
        break;
    }
  }

  if (ors.length === 0) return undefined;
  if (ors.length === 1) return ors[0];
  return { OR: ors };
}

export function andStornoStatusWhere(
  base: Prisma.ContractWhereInput,
  stornoWhere: Prisma.ContractWhereInput | undefined,
): Prisma.ContractWhereInput {
  if (!stornoWhere) return base;
  return { AND: [base, stornoWhere] };
}

type PodRow = {
  id: string;
  podPdr: string | null;
  pod: string | null;
  pdr: string | null;
};

/**
 * Contratti con stesso POD normalizzato (B1/B3) presenti ≥2 volte nello scope.
 * Query scoped + raggruppamento in memoria (Neon HTTP: niente self-join).
 */
export async function loadDoppiaPosizioneContractIds(
  db: {
    contract: {
      findMany: (args: {
        where: Prisma.ContractWhereInput;
        select: {
          id: true;
          podPdr: true;
          pod: true;
          pdr: true;
        };
      }) => Promise<PodRow[]>;
    };
  },
  scopeWhere: Prisma.ContractWhereInput,
): Promise<string[]> {
  const rows = await db.contract.findMany({
    where: {
      AND: [
        scopeWhere,
        { deletedAt: null },
        {
          OR: [
            { AND: [{ podPdr: { not: null } }, { NOT: { podPdr: "" } }] },
            { AND: [{ pod: { not: null } }, { NOT: { pod: "" } }] },
            { AND: [{ pdr: { not: null } }, { NOT: { pdr: "" } }] },
          ],
        },
      ],
    },
    select: { id: true, podPdr: true, pod: true, pdr: true },
  });

  const byKey = new Map<string, string[]>();
  for (const r of rows) {
    const key = normalizePodKey(r.podPdr || r.pod || r.pdr);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(r.id);
    byKey.set(key, list);
  }

  const out: string[] = [];
  for (const list of byKey.values()) {
    if (list.length > 1) out.push(...list);
  }
  return out;
}

/** Etichette per hint elenco (es. «In storno + Storico»). */
export function stornoFilterHintLabels(ids: StornoBadgeId[]): string | null {
  if (ids.length === 0) return null;
  return ids.map((id) => STORNO_BADGE_DEFS[id].label).join(" + ");
}

export { FILTER_LIST_SEP };
