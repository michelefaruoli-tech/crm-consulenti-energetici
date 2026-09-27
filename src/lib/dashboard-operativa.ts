/**
 * P1.3 — Dashboard operativa: KPI economici, alert e azioni rapide.
 * Contatori DB-side con scope/permessi; deep-link a liste filtrate esistenti.
 * `now` e periodo sempre dal caller (page). Non altera motore latest/switch/provvigioni.
 */

import type { Prisma } from "@/generated/prisma/client";
import { formatCurrency } from "@/lib/commission";
import { buildPageHref } from "@/lib/pagination";
import { heliosLastPayableCompetence } from "@/lib/helios-contract-rules";
import {
  loadDashboardMoneyTotals,
  type DashboardMoneyTotals,
} from "@/lib/provvigioni-summary";
import {
  fuoriStornoWhere,
  provvigioneStatoWhere,
  recurringMonthlyWhereOr,
} from "@/lib/provvigioni-filters";
import { sumExpandedAmountForStato } from "@/lib/provvigioni-rows";
import { provvigioniDeepLinkHref } from "@/lib/provvigioni-deep-links";
import {
  stornoDashboardListHref,
  stornoDatePeriodWhere,
  type OptionalDashboardPeriod,
} from "@/lib/storno-dashboard-kpi";
import { stornatoFilterWhere, andStornoStatusWhere } from "@/lib/storno-filters";
import { notAnnualNextHiddenWhere, toPeriod } from "@/lib/recurring";
import { prisma } from "@/lib/prisma";

/** Giorni oltre i quali «Incassato» non liquidato genera alert. */
export const INCASSATO_NON_LIQUIDATO_DAYS = 30;

/**
 * Allineato a `STALE_LAVORAZIONE_HOURS` in stale-lavorazione-alert.ts
 * (non importiamo quel modulo: è `server-only` e romperebbe i check tsx).
 */
export const STALE_LAVORAZIONE_HOURS = 48;

export type DashboardOperativaTone = "default" | "success" | "warning" | "danger";

export type DashboardOperativaKpiCard = {
  id:
    | "da_incassare"
    | "incassato_fornitore"
    | "da_liquidare"
    | "liquidato"
    | "ut_da_incassare"
    | "ricorrenti_mensili_mese"
    | "ricorrenti_annuali"
    | "storni_periodo";
  label: string;
  /** Importo formattato (€) o conteggio. */
  value: string;
  hint: string;
  href: string;
  tone: DashboardOperativaTone;
};

export type DashboardOperativaAlert = {
  id:
    | "errore_invio"
    | "lavorazione_stale"
    | "documentazione_incompleta"
    | "pod_duplicati"
    | "rate_mancanti"
    | "incassato_non_liquidato"
    | "anomalie_integrita"
    | "helios_m2";
  label: string;
  hint: string;
  count: number;
  href: string;
  priority: "alta" | "media" | "bassa";
  tone: DashboardOperativaTone;
};

export type DashboardQuickAction = {
  id: string;
  label: string;
  href: string;
};

export type DashboardOperativaLinkExtras = {
  collab?: string | null;
  supplierName?: string | null;
};

type CountDb = {
  contract: {
    count: (args: { where: Prisma.ContractWhereInput }) => Promise<number>;
  };
  recurringMonth: {
    count: (args: { where: Prisma.RecurringMonthWhereInput }) => Promise<number>;
    aggregate: (args: {
      where: Prisma.RecurringMonthWhereInput;
      _sum: { amount: true };
    }) => Promise<{ _sum: { amount: unknown } }>;
  };
  commission: {
    aggregate: (args: {
      where: Prisma.CommissionWhereInput;
      _sum: { stornoAmount: true };
      _count: true;
    }) => Promise<{ _sum: { stornoAmount: unknown }; _count: number }>;
  };
};

function linkExtrasParams(
  extras: DashboardOperativaLinkExtras,
): Record<string, string | undefined> {
  return {
    collab: extras.collab || undefined,
    supplier: extras.supplierName || undefined,
  };
}

/** Competence YYYY-MM per «ricorrenti del mese»: month filtro Dashboard o mese di `now`. */
export function resolveOperativaCompetenceMonth(opts: {
  now: Date;
  period?: OptionalDashboardPeriod | null;
}): string {
  if (opts.period?.months.length === 1) return opts.period.months[0]!;
  if (opts.period?.from) {
    const m = opts.period.from.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(m)) return m;
  }
  return toPeriod(opts.now);
}

/**
 * Estende i money totals Dashboard con Liquidato e totale da incassare (UT+R+M).
 * Serie (non Promise.all) per Neon HTTP.
 */
export async function loadOperativaMoneyBundle(
  contractWhere: Prisma.ContractWhereInput,
): Promise<
  DashboardMoneyTotals & {
    liquidato: number;
    daIncassareTotale: number;
    incassatoFornitore: number;
  }
> {
  const base = await loadDashboardMoneyTotals(contractWhere);
  const liquidatoWhere: Prisma.ContractWhereInput = {
    AND: [contractWhere, provvigioneStatoWhere("Pagato") ?? {}],
  };
  const liquidato = await sumExpandedAmountForStato(
    liquidatoWhere,
    "pagato",
    null,
    "Pagato",
  );
  const daIncassareTotale = base.daIncassare + base.ricorrenti;
  return {
    ...base,
    liquidato,
    daIncassareTotale,
    /** Tutto quanto ricevuto dal fornitore (coda liquidazione + già liquidato). */
    incassatoFornitore: base.incassato + liquidato,
  };
}

/** Importo ricorrenti mensili (M) da incassare per una competenza specifica. */
export async function sumRicorrentiMensiliCompetence(opts: {
  db?: CountDb;
  contractWhere: Prisma.ContractWhereInput;
  competence: string;
  now: Date;
}): Promise<number> {
  const db = opts.db ?? prisma;
  const lastHelios = heliosLastPayableCompetence(opts.now);
  const heliosCompetencePayable = opts.competence <= lastHelios;
  const supplierGate: Prisma.ContractWhereInput = heliosCompetencePayable
    ? {}
    : {
        NOT: {
          supplier: {
            name: { contains: "helios", mode: "insensitive" },
          },
        },
      };
  const agg = await db.recurringMonth.aggregate({
    where: {
      period: opts.competence,
      status: { in: ["MISSING", "PENDING", "ERROR_UNPAID"] },
      ...notAnnualNextHiddenWhere,
      contract: {
        AND: [
          opts.contractWhere,
          { OR: recurringMonthlyWhereOr },
          supplierGate,
        ],
      },
    },
    _sum: { amount: true },
  });
  return Number(agg._sum.amount ?? 0) || 0;
}

/** Conteggio + somma stornoAmount per contratti stornati (periodo opzionale su stornoDate). */
export async function loadStorniPeriodTotals(opts: {
  db?: CountDb;
  scopeWhere: Prisma.ContractWhereInput;
  period?: OptionalDashboardPeriod | null;
}): Promise<{ count: number; amount: number }> {
  const db = opts.db ?? prisma;
  const stornatoBase = andStornoStatusWhere(
    opts.scopeWhere,
    stornatoFilterWhere(),
  );
  const where = opts.period
    ? { AND: [stornatoBase, stornoDatePeriodWhere(opts.period)] }
    : stornatoBase;

  const count = await db.contract.count({ where });
  const agg = await db.commission.aggregate({
    where: {
      contract: where,
      OR: [{ stornoDate: { not: null } }, { stornoAmount: { not: null } }],
    },
    _sum: { stornoAmount: true },
    _count: true,
  });
  return {
    count,
    amount: Number(agg._sum.stornoAmount ?? 0) || 0,
  };
}

export function buildOperativaKpiCards(opts: {
  money: Awaited<ReturnType<typeof loadOperativaMoneyBundle>>;
  ricorrentiMese: number;
  storni: { count: number; amount: number };
  competence: string;
  period: OptionalDashboardPeriod | null;
  linkExtras: DashboardOperativaLinkExtras;
}): DashboardOperativaKpiCard[] {
  const ex = linkExtrasParams(opts.linkExtras);
  const storniHref = stornoDashboardListHref({
    storno: "stornato",
    list: "provvigioni",
    collab: opts.linkExtras.collab,
    supplierName: opts.linkExtras.supplierName,
  });

  return [
    {
      id: "da_incassare",
      label: "Da incassare",
      value: formatCurrency(opts.money.daIncassareTotale),
      hint: "UT + annuali R + rate M — fornitore non ancora pagato",
      href: provvigioniDeepLinkHref("da-incassare", ex),
      tone: "warning",
    },
    {
      id: "incassato_fornitore",
      label: "Incassato dal fornitore",
      value: formatCurrency(opts.money.incassatoFornitore),
      hint: "Incassato da liquidare + già liquidato al collaboratore",
      href: provvigioniDeepLinkHref("incassato-da-liquidare", ex),
      tone: "success",
    },
    {
      id: "da_liquidare",
      label: "Da liquidare al collaboratore",
      value: formatCurrency(opts.money.incassato),
      hint: "Fornitore pagato, collaboratore no",
      href: provvigioniDeepLinkHref("incassato-da-liquidare", ex),
      tone: "warning",
    },
    {
      id: "liquidato",
      label: "Liquidato al collaboratore",
      value: formatCurrency(opts.money.liquidato),
      hint: "Provvigioni già liquidate (alias Pagato)",
      href: provvigioniDeepLinkHref("liquidato", ex),
      tone: "success",
    },
    {
      id: "ut_da_incassare",
      label: "Una tantum da incassare",
      value: formatCurrency(opts.money.daIncassareUt),
      hint: "Solo gettoni UT",
      href: provvigioniDeepLinkHref("ut-da-incassare", ex),
      tone: "warning",
    },
    {
      id: "ricorrenti_mensili_mese",
      label: "Ricorrenti mensili del mese",
      value: formatCurrency(opts.ricorrentiMese),
      hint: `Competenza ${opts.competence} · Helios solo se già in M+2`,
      href: provvigioniDeepLinkHref("da-incassare-m", {
        ...ex,
        competence: opts.competence,
      }),
      tone: "default",
    },
    {
      id: "ricorrenti_annuali",
      label: "Ricorrenti annuali maturati",
      value: formatCurrency(opts.money.daIncassareR),
      hint: "Annuali R da incassare",
      href: provvigioniDeepLinkHref("da-incassare-r", ex),
      tone: "default",
    },
    {
      id: "storni_periodo",
      label: opts.period
        ? "Storni/rettifiche del periodo"
        : "Storni/rettifiche",
      value:
        opts.storni.amount > 0
          ? formatCurrency(opts.storni.amount)
          : String(opts.storni.count),
      hint:
        opts.storni.amount > 0
          ? `${opts.storni.count} pratiche · importo storno`
          : "Pratiche STORNATO / con data storno",
      href: storniHref,
      tone: "danger",
    },
  ];
}

function anomalieOperativeWhere(
  scopeWhere: Prisma.ContractWhereInput,
  now: Date,
): Prisma.ContractWhereInput {
  const periodLt = toPeriod(now);
  return {
    AND: [
      scopeWhere,
      {
        OR: [
          {
            recurringMonths: {
              some: {
                status: { in: ["MISSING", "PENDING"] },
                period: { lt: periodLt },
                ...notAnnualNextHiddenWhere,
              },
            },
          },
          {
            recurringMonths: {
              some: {
                status: "ERROR_UNPAID",
                note: { contains: "ASSENTE_RENDICONTO" },
              },
            },
          },
          fuoriStornoWhere(),
        ],
      },
    ],
  };
}

export async function loadOperativaAlerts(opts: {
  db?: CountDb;
  scopeWhere: Prisma.ContractWhereInput;
  now: Date;
  doppiaIds: string[];
  linkExtras: DashboardOperativaLinkExtras;
}): Promise<DashboardOperativaAlert[]> {
  const db = opts.db ?? prisma;
  const ex = linkExtrasParams(opts.linkExtras);
  const cutoffStale = new Date(
    opts.now.getTime() - STALE_LAVORAZIONE_HOURS * 60 * 60 * 1000,
  );
  const cutoffIncassato = new Date(
    opts.now.getTime() - INCASSATO_NON_LIQUIDATO_DAYS * 24 * 60 * 60 * 1000,
  );
  const lastHelios = heliosLastPayableCompetence(opts.now);

  // Serie per Neon HTTP (evita saturazione).
  const erroreInvio = await db.contract.count({
    where: {
      AND: [
        opts.scopeWhere,
        { isHistorical: false },
        {
          OR: [
            { status: "ERRORE_INVIO" },
            { emailStatus: "ERROR" },
          ],
        },
      ],
    },
  });

  const lavorazioneStale = await db.contract.count({
    where: {
      AND: [
        opts.scopeWhere,
        {
          isHistorical: false,
          sendToMaster: true,
          assignedToMaster: true,
          status: "IN_LAVORAZIONE",
          OR: [
            { sentToMasterAt: { lte: cutoffStale } },
            {
              AND: [
                { sentToMasterAt: null },
                { insertionDate: { lte: cutoffStale } },
              ],
            },
          ],
        },
      ],
    },
  });

  const documentazioneIncompleta = await db.contract.count({
    where: {
      AND: [
        opts.scopeWhere,
        { isHistorical: false, status: "DOCUMENTAZIONE_INCOMPLETA" },
      ],
    },
  });

  const podDuplicati = opts.doppiaIds.length;

  const rateMancanti = await db.recurringMonth.count({
    where: {
      status: "MISSING",
      period: { lt: toPeriod(opts.now) },
      contract: {
        AND: [
          opts.scopeWhere,
          { isHistorical: false },
        ],
      },
    },
  });

  const incassatoNonLiquidato = await db.contract.count({
    where: {
      AND: [
        opts.scopeWhere,
        { isHistorical: false },
        provvigioneStatoWhere("Incassato") ?? {},
        {
          OR: [
            { collectionDate: { lte: cutoffIncassato } },
            {
              recurringMonths: {
                some: {
                  status: "PAID",
                  paidAt: { lte: cutoffIncassato },
                },
              },
            },
          ],
        },
      ],
    },
  });

  const anomalie = await db.contract.count({
    where: anomalieOperativeWhere(
      { AND: [opts.scopeWhere, { isHistorical: false }] },
      opts.now,
    ),
  });

  const heliosM2 = await db.recurringMonth.count({
    where: {
      period: { gt: lastHelios },
      status: { not: "CLOSED" },
      contract: {
        AND: [
          opts.scopeWhere,
          { isHistorical: false, deletedAt: null },
          {
            supplier: {
              name: { contains: "helios", mode: "insensitive" },
            },
          },
        ],
      },
    },
  });

  return [
    {
      id: "errore_invio",
      label: "Contratti in errore di invio",
      hint: "Status ERRORE_INVIO o emailStatus ERROR",
      count: erroreInvio,
      href: buildPageHref("/contratti", {
        vista: "attivi",
        status: "ERRORE_INVIO",
        collab: ex.collab,
      }),
      priority: "alta",
      tone: "danger",
    },
    {
      id: "lavorazione_stale",
      label: `Pratiche ferme in lavorazione (>${STALE_LAVORAZIONE_HOURS}h)`,
      hint: "Inviate al Master e ferme oltre soglia",
      count: lavorazioneStale,
      href: buildPageHref("/lavorazione", { stale: "1" }),
      priority: "alta",
      tone: "warning",
    },
    {
      id: "documentazione_incompleta",
      label: "Documenti obbligatori mancanti",
      hint: "Proxy: status DOCUMENTAZIONE_INCOMPLETA (checklist fornitori non in schema)",
      count: documentazioneIncompleta,
      href: buildPageHref("/contratti", {
        vista: "attivi",
        status: "DOCUMENTAZIONE_INCOMPLETA",
        collab: ex.collab,
      }),
      priority: "media",
      tone: "warning",
    },
    {
      id: "pod_duplicati",
      label: "POD/PDR duplicati e possibili switch",
      hint: "Stesso POD normalizzato su ≥2 contratti (filtro doppia posizione)",
      count: podDuplicati,
      href: stornoDashboardListHref({
        storno: "doppia_posizione",
        collab: opts.linkExtras.collab,
        supplierName: opts.linkExtras.supplierName,
      }),
      priority: "media",
      tone: "warning",
    },
    {
      id: "rate_mancanti",
      label: "Rate attese mancanti",
      hint: "RecurringMonth MISSING con periodo passato",
      count: rateMancanti,
      href: provvigioniDeepLinkHref("ricorrenze-mancanti", ex),
      priority: "alta",
      tone: "danger",
    },
    {
      id: "incassato_non_liquidato",
      label: `Incassato non liquidato (>${INCASSATO_NON_LIQUIDATO_DAYS}gg)`,
      hint: "Coda Incassato da liquidare con data incasso oltre soglia",
      count: incassatoNonLiquidato,
      href: provvigioniDeepLinkHref("incassato-da-liquidare", ex),
      priority: "alta",
      tone: "warning",
    },
    {
      id: "anomalie_integrita",
      label: "Anomalie integrità",
      hint: "Vista unificata rate mancanti / Helios assenti / fuori storno",
      count: anomalie,
      href: provvigioniDeepLinkHref("anomalie", ex),
      priority: "media",
      tone: "default",
    },
    {
      id: "helios_m2",
      label: "Helios in finestra M+2",
      hint: `Rate con competenza > ${lastHelios} (non ancora pagabili)`,
      count: heliosM2,
      href: "/backup#integrita",
      priority: "bassa",
      tone: "default",
    },
  ];
}

export function buildDashboardQuickActions(
  linkExtras: DashboardOperativaLinkExtras,
): DashboardQuickAction[] {
  const ex = linkExtrasParams(linkExtras);
  return [
    {
      id: "nuovo_contratto",
      label: "Nuovo contratto",
      href: "/contratti/nuovo",
    },
    {
      id: "pratiche_lavorare",
      label: "Apri pratiche da lavorare",
      href: "/lavorazione",
    },
    {
      id: "provvigioni_da_incassare",
      label: "Apri provvigioni da incassare",
      href: provvigioniDeepLinkHref("da-incassare", ex),
    },
    {
      id: "da_liquidare",
      label: "Apri da liquidare",
      href: provvigioniDeepLinkHref("incassato-da-liquidare", ex),
    },
    {
      id: "importa_rendiconto",
      label: "Importa rendiconto",
      href: "/archivio#helios-import",
    },
    {
      id: "anomalie",
      label: "Apri anomalie",
      href: provvigioniDeepLinkHref("anomalie", ex),
    },
    {
      id: "genera_report",
      label: "Genera report",
      href: "/report",
    },
  ];
}
