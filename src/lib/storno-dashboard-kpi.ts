/**
 * P1.2 B5 — KPI / alert storno Dashboard (ponte P1.3).
 * Contatori DB-side con scope/permessi; deep-link alle liste `?storno=` (B4).
 * `now` e periodo sempre dal caller (page/request).
 */

import type { Prisma } from "@/generated/prisma/client";
import { buildPageHref } from "@/lib/pagination";
import { panelContractScopeWhere } from "@/lib/visibility-scope";
import {
  STORNO_BADGE_DEFS,
  type StornoBadgeId,
} from "@/lib/storno-badges";
import {
  andStornoStatusWhere,
  buildStornoStatusWhere,
  formatStornoStatusFilters,
  inStornoWhere,
  loadDoppiaPosizioneContractIds,
  STORNO_FILTER_IDS,
  stornoInScadenzaWhere,
  stornatoFilterWhere,
} from "@/lib/storno-filters";
import { STORNO_WARNING_DAYS } from "@/lib/storno-status";
import {
  monthToDateRange,
  parseMonthList,
} from "@/lib/report-month";
import { reportDateRange } from "@/lib/report-filters";
import { parseFilterList } from "@/lib/filter-list";

export type StornoKpiCounts = Record<StornoBadgeId, number>;

export type StornoDashboardAlert = {
  id: "scadenza" | "doppia_storno_attivo" | "stornati_periodo";
  label: string;
  hint: string;
  count: number;
  href: string;
  tone: "warning" | "danger" | "default";
};

export type StornoDashboardKpiCard = {
  id: StornoBadgeId;
  label: string;
  count: number;
  href: string;
  tone: "default" | "success" | "warning" | "danger";
};

/** Periodo opzionale Dashboard (senza default mese corrente). */
export type OptionalDashboardPeriod = {
  from: string;
  to: string;
  months: string[];
};

/**
 * Risolve `month` / `from` / `to` solo se presenti.
 * Diverso da Report: senza parametri → nessun vincolo periodo.
 */
export function resolveOptionalDashboardPeriod(params: {
  from?: string | null;
  to?: string | null;
  month?: string | null;
}): OptionalDashboardPeriod | null {
  const months = parseMonthList(params.month);
  if (months.length > 0) {
    const first = monthToDateRange(months[0]!);
    const last = monthToDateRange(months[months.length - 1]!);
    if (!first || !last) return null;
    return { from: first.from, to: last.to, months };
  }
  const from = params.from?.trim() || "";
  const to = params.to?.trim() || "";
  if (!from && !to) return null;
  if (from && to) return { from, to, months: [] };
  if (from) return { from, to: from, months: [] };
  return { from: to, to, months: [] };
}

/** Where su data inserimento (KPI snapshot filtrati per periodo). */
export function insertionPeriodWhere(
  period: OptionalDashboardPeriod,
): Prisma.ContractWhereInput {
  if (period.months.length > 1) {
    return {
      OR: period.months.map((m) => {
        const r = monthToDateRange(m)!;
        const { dateFrom, dateTo } = reportDateRange(r.from, r.to);
        return { insertionDate: { gte: dateFrom, lte: dateTo } };
      }),
    };
  }
  const { dateFrom, dateTo } = reportDateRange(period.from, period.to);
  return { insertionDate: { gte: dateFrom, lte: dateTo } };
}

/** Where su data storno commissione (alert «stornati nel periodo»). */
export function stornoDatePeriodWhere(
  period: OptionalDashboardPeriod,
): Prisma.ContractWhereInput {
  if (period.months.length > 1) {
    return {
      OR: period.months.map((m) => {
        const r = monthToDateRange(m)!;
        const { dateFrom, dateTo } = reportDateRange(r.from, r.to);
        return { commission: { stornoDate: { gte: dateFrom, lte: dateTo } } };
      }),
    };
  }
  const { dateFrom, dateTo } = reportDateRange(period.from, period.to);
  return {
    commission: { stornoDate: { gte: dateFrom, lte: dateTo } },
  };
}

/**
 * Scope Dashboard storno: visibility + collab + supplierId + deletedAt.
 * Allineato a `panelContractScopeWhere` (Anomalie / liste).
 */
export function buildStornoDashboardScopeWhere(opts: {
  visibility: Prisma.ContractWhereInput;
  collab?: string | null;
  supplierIds?: string[];
}): Prisma.ContractWhereInput {
  const base = panelContractScopeWhere(opts.visibility, opts.collab);
  const parts: Prisma.ContractWhereInput[] = [
    { deletedAt: null },
    base,
  ];
  const ids = (opts.supplierIds ?? []).filter(Boolean);
  if (ids.length === 1) {
    parts.push({ supplierId: ids[0]! });
  } else if (ids.length > 1) {
    parts.push({ supplierId: { in: ids } });
  }
  return { AND: parts };
}

const KPI_TONE: Record<StornoBadgeId, StornoDashboardKpiCard["tone"]> = {
  in_storno: "danger",
  storno_in_scadenza: "warning",
  fuori_storno: "success",
  doppia_posizione: "warning",
  storico: "default",
  stornato: "danger",
};

/**
 * Deep-link lista con `?storno=` B4.
 * Contratti per stati strutturali; Provvigioni per Stornato (ciclo economico).
 * Preserva collab / supplier (nome, come Provvigioni).
 */
export function stornoDashboardListHref(opts: {
  storno: StornoBadgeId | StornoBadgeId[];
  list?: "contratti" | "provvigioni";
  collab?: string | null;
  /** Nome fornitore (Provvigioni); ignorato su Contratti. */
  supplierName?: string | null;
}): string {
  const ids = Array.isArray(opts.storno) ? opts.storno : [opts.storno];
  const stornoParam = formatStornoStatusFilters(ids);
  const primary = ids[0] ?? "in_storno";
  const list =
    opts.list ??
    (primary === "stornato" ? "provvigioni" : "contratti");

  if (list === "provvigioni") {
    return buildPageHref("/provvigioni", {
      storno: stornoParam,
      collab: opts.collab || undefined,
      supplier: opts.supplierName || undefined,
    });
  }

  const vista =
    primary === "storico"
      ? "storico"
      : primary === "stornato"
        ? "tutti"
        : "attivi";

  return buildPageHref("/contratti", {
    vista,
    storno: stornoParam,
    collab: opts.collab || undefined,
  });
}

type CountDb = {
  contract: {
    count: (args: { where: Prisma.ContractWhereInput }) => Promise<number>;
    findMany: (args: {
      where: Prisma.ContractWhereInput;
      select: {
        id: true;
        podPdr: true;
        pod: true;
        pdr: true;
      };
    }) => Promise<
      Array<{
        id: string;
        podPdr: string | null;
        pod: string | null;
        pdr: string | null;
      }>
    >;
  };
};

export async function loadStornoDashboardKpis(opts: {
  db: CountDb;
  scopeWhere: Prisma.ContractWhereInput;
  now: Date;
  /** Se presente, restringe i conteggi per data inserimento. */
  period?: OptionalDashboardPeriod | null;
}): Promise<{
  counts: StornoKpiCounts;
  doppiaIds: string[];
}> {
  const periodPart = opts.period ? insertionPeriodWhere(opts.period) : undefined;
  const scopedBase = periodPart
    ? { AND: [opts.scopeWhere, periodPart] }
    : opts.scopeWhere;

  const doppiaIds = await loadDoppiaPosizioneContractIds(opts.db, scopedBase);

  const counts = {} as StornoKpiCounts;
  await Promise.all(
    STORNO_FILTER_IDS.map(async (id) => {
      const stornoWhere = buildStornoStatusWhere([id], {
        now: opts.now,
        doppiaIds,
      });
      counts[id] = await opts.db.contract.count({
        where: andStornoStatusWhere(scopedBase, stornoWhere),
      });
    }),
  );

  return { counts, doppiaIds };
}

/**
 * Alert prioritari:
 * 1. Storno in scadenza entro X giorni (default STORNO_WARNING_DAYS)
 * 2. Doppia posizione con storno ancora attivo (in_storno ∨ in_scadenza)
 * 3. Contratti stornati nel periodo (stornoDate; senza periodo = tutti i stornati)
 */
export async function loadStornoDashboardAlerts(opts: {
  db: CountDb;
  scopeWhere: Prisma.ContractWhereInput;
  now: Date;
  period?: OptionalDashboardPeriod | null;
  /** Giorni soglia scadenza (default 30). */
  warningDays?: number;
  collab?: string | null;
  supplierName?: string | null;
  /** ID doppia già calcolati sullo stesso scope (evita doppia query POD). */
  doppiaIds?: string[];
}): Promise<StornoDashboardAlert[]> {
  const warningDays = opts.warningDays ?? STORNO_WARNING_DAYS;
  const periodPart = opts.period ? insertionPeriodWhere(opts.period) : undefined;
  const scopedBase = periodPart
    ? { AND: [opts.scopeWhere, periodPart] }
    : opts.scopeWhere;

  const doppiaIds =
    opts.doppiaIds ??
    (await loadDoppiaPosizioneContractIds(opts.db, scopedBase));

  // 1) In scadenza — stesso where B4 (30g); warningDays documentato nell’alert
  const scadenzaCount = await opts.db.contract.count({
    where: andStornoStatusWhere(scopedBase, stornoInScadenzaWhere(opts.now)),
  });

  // 2) Intersezione doppia ∩ (in_storno ∨ in_scadenza)
  let doppiaAttivoCount = 0;
  if (doppiaIds.length > 0) {
    doppiaAttivoCount = await opts.db.contract.count({
      where: {
        AND: [
          scopedBase,
          { id: { in: doppiaIds } },
          {
            OR: [inStornoWhere(opts.now), stornoInScadenzaWhere(opts.now)],
          },
        ],
      },
    });
  }

  // 3) Stornati nel periodo (su stornoDate); senza periodo = filtro stornato B4
  const stornatoBase = andStornoStatusWhere(opts.scopeWhere, stornatoFilterWhere());
  const stornatiWhere = opts.period
    ? { AND: [stornatoBase, stornoDatePeriodWhere(opts.period)] }
    : stornatoBase;
  const stornatiCount = await opts.db.contract.count({ where: stornatiWhere });

  const linkExtras = {
    collab: opts.collab,
    supplierName: opts.supplierName,
  };

  return [
    {
      id: "scadenza",
      label: `Storno in scadenza entro ${warningDays} giorni`,
      hint: "Fine periodo storno imminente — verifica ricontrattualizzazione",
      count: scadenzaCount,
      href: stornoDashboardListHref({
        storno: "storno_in_scadenza",
        ...linkExtras,
      }),
      tone: "warning",
    },
    {
      id: "doppia_storno_attivo",
      label: "Doppie posizioni con storno attivo",
      hint: "Stesso POD con almeno un contratto ancora in storno",
      count: doppiaAttivoCount,
      href: stornoDashboardListHref({
        storno: "doppia_posizione",
        ...linkExtras,
      }),
      tone: "danger",
    },
    {
      id: "stornati_periodo",
      label: opts.period
        ? "Contratti stornati nel periodo"
        : "Contratti stornati",
      hint: opts.period
        ? "Clawback / status STORNATO con data storno nel periodo selezionato"
        : "Clawback o status STORNATO nello scope attuale",
      count: stornatiCount,
      href: stornoDashboardListHref({
        storno: "stornato",
        list: "provvigioni",
        ...linkExtras,
      }),
      tone: "danger",
    },
  ];
}

export function buildStornoKpiCards(
  counts: StornoKpiCounts,
  linkExtras: {
    collab?: string | null;
    supplierName?: string | null;
  },
): StornoDashboardKpiCard[] {
  return STORNO_FILTER_IDS.map((id) => ({
    id,
    label: STORNO_BADGE_DEFS[id].label,
    count: counts[id],
    href: stornoDashboardListHref({ storno: id, ...linkExtras }),
    tone: KPI_TONE[id],
  }));
}

export function parseDashboardCollabParam(
  raw: string | null | undefined,
): string | undefined {
  const v = raw?.trim();
  if (!v || v === "tutti") return undefined;
  return v;
}

export function parseDashboardSupplierIds(
  raw: string | null | undefined,
): string[] {
  return parseFilterList(raw);
}

export { STORNO_WARNING_DAYS, STORNO_FILTER_IDS };
