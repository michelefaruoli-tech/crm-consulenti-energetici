/**
 * Rate ricorrenti da includere nel Report.
 * Il mese del Report è la colonna Incasso di Provvigioni:
 * `settledPeriod` se il fornitore ha già pagato, altrimenti la competenza.
 * L’importo è quello della rata (se > 0), altrimenti il gettone del contratto.
 */
import type { Prisma } from "@/generated/prisma/client";
import {
  HELIOS_FIRST_MONTH_VISIBLE_OPERATION_TYPES,
  heliosLastPayableCompetence,
} from "@/lib/helios-contract-rules";
import { prisma } from "@/lib/prisma";
import { effectiveGettone } from "@/lib/provvigioni-stato";
import { provvigioneStatoWhere } from "@/lib/provvigioni-filters";
import { loadArchivedAnnualLiquidatedRateIds } from "@/lib/provvigioni-rows";
import {
  parseFilterList,
  resolveReportPeriod,
  resolveReportStati,
} from "@/lib/report-filters";
import { REPORT_MONTH_LABELS } from "@/lib/report-month";
import { notAnnualNextHiddenWhere } from "@/lib/recurring";

const RECURRING_UNPAID_STATUSES = [
  "MISSING",
  "PENDING",
  "ERROR_UNPAID",
] as const;

/** Stesso gating Helios M+2 di `expandedRateWhere` in provvigioni-rows. */
export function reportRecurringHeliosLagWhere(
  now: Date = new Date(),
): Prisma.RecurringMonthWhereInput {
  const lastHelios = heliosLastPayableCompetence(now);
  return {
    NOT: {
      AND: [
        { period: { gt: lastHelios } },
        {
          contract: {
            supplier: { name: { contains: "helios", mode: "insensitive" } },
            OR: [
              { operationType: null },
              {
                NOT: {
                  operationType: {
                    in: [...HELIOS_FIRST_MONTH_VISIBLE_OPERATION_TYPES],
                  },
                },
              },
            ],
          },
        },
      ],
    },
  };
}

function recurringStatusGroups(stato?: string | null): {
  unpaid: string[];
  paid: string[];
} {
  const stati = resolveReportStati(stato);
  const unpaid: string[] = [];
  const paid: string[] = [];
  if (stati.includes("Tutti") || stati.includes("Da incassare")) {
    unpaid.push(...RECURRING_UNPAID_STATUSES);
  }
  if (stati.includes("Tutti") || stati.includes("Incassato")) {
    paid.push("PAID");
  }
  if (stati.includes("Tutti") || stati.includes("Pagato")) {
    paid.push("LIQUIDATED");
  }
  if (unpaid.length === 0 && paid.length === 0) {
    paid.push("PAID");
  }
  return {
    unpaid: [...new Set(unpaid)],
    paid: [...new Set(paid)],
  };
}

/**
 * Stessa regola della colonna Incasso in Provvigioni.
 * Una rata sta in un solo mese: il pagamento (`settledPeriod`) se c’è,
 * altrimenti la competenza (`period`). Non entra sia a settembre sia a ottobre.
 */
export function reportIncassoMonthWhere(
  periods: string[],
): Prisma.RecurringMonthWhereInput {
  return {
    OR: [
      { settledPeriod: { in: periods } },
      { AND: [{ settledPeriod: null }, { period: { in: periods } }] },
    ],
  };
}

/**
 * Rate «Da incassare» non hanno mese di incasso: nessun filtro periodo.
 * Incassato / Pagato usano il mese di incasso (non la sola competenza).
 */
export function buildReportRecurringWhere(params: {
  from?: string | null;
  to?: string | null;
  month?: string | null;
  stato?: string | null;
  competenceOnly?: boolean;
  visibility: Prisma.ContractWhereInput;
  collaboratorId?: string | null;
  supplierId?: string | null;
  now?: Date;
}): Prisma.RecurringMonthWhereInput | null {
  const period = resolveReportPeriod(params);
  const periods = period.allPeriods
    ? []
    : periodsInRange(period.from, period.to, period.month);
  const { unpaid, paid } = recurringStatusGroups(params.stato);
  if (unpaid.length === 0 && paid.length === 0) return null;
  if (
    paid.length > 0 &&
    periods.length === 0 &&
    unpaid.length === 0 &&
    !period.allPeriods
  ) {
    return null;
  }

  const collabIds = parseFilterList(params.collaboratorId);
  const supplierIds = parseFilterList(params.supplierId);
  /** Stesso perimetro Provvigioni: non escludere `isHistorical`. */
  const contractAnd: Prisma.ContractWhereInput[] = [
    params.visibility,
    { deletedAt: null },
    ...(collabIds.length === 1
      ? [{ collaboratorId: collabIds[0]! }]
      : collabIds.length > 1
        ? [{ collaboratorId: { in: collabIds } }]
        : []),
    ...(supplierIds.length === 1
      ? [{ supplierId: supplierIds[0]! }]
      : supplierIds.length > 1
        ? [{ supplierId: { in: supplierIds } }]
        : []),
  ];

  const heliosLag = reportRecurringHeliosLagWhere(params.now ?? new Date());
  const incassoWhere =
    periods.length > 0 ? reportIncassoMonthWhere(periods) : null;

  const branches: Prisma.RecurringMonthWhereInput[] = [];

  /**
   * Incassato = rate PAID, Pagato = rate LIQUIDATED.
   * Il contratto deve passare lo stesso stato di Provvigioni, così un KO
   * storico con rata pagata non entra nel Report.
   * Con «tutti i periodi» non si filtra il mese di incasso (come la card).
   */
  if (paid.includes("PAID") && (periods.length > 0 || period.allPeriods)) {
    const statoWhere = provvigioneStatoWhere("Incassato");
    branches.push({
      AND: [
        { status: "PAID" },
        ...(incassoWhere ? [incassoWhere] : []),
        heliosLag,
        notAnnualNextHiddenWhere,
        {
          contract: {
            AND: [...contractAnd, ...(statoWhere ? [statoWhere] : [])],
          },
        },
      ],
    });
  }
  if (
    paid.includes("LIQUIDATED") &&
    (periods.length > 0 || period.allPeriods)
  ) {
    const statoWhere = provvigioneStatoWhere("Pagato");
    branches.push({
      AND: [
        { status: "LIQUIDATED" },
        ...(incassoWhere ? [incassoWhere] : []),
        heliosLag,
        notAnnualNextHiddenWhere,
        {
          contract: {
            AND: [...contractAnd, ...(statoWhere ? [statoWhere] : [])],
          },
        },
      ],
    });
  }

  if (unpaid.length > 0) {
    branches.push({
      AND: [
        { status: { in: unpaid } },
        heliosLag,
        { contract: { AND: contractAnd } },
      ],
    });
  }

  if (branches.length === 0) return null;
  if (branches.length === 1) return branches[0]!;
  return { OR: branches };
}

export type ReportRecurringRow = {
  id: string;
  contractId: string;
  period: string;
  settledPeriod: string | null;
  /** PAID = incassato da liquidare, LIQUIDATED = già liquidato. */
  status: string;
  amount: number;
  paidAt: Date | null;
  contractNumber: string;
  podPdr: string | null;
  collaboratorId: string;
  collaboratorName: string;
  supplierName: string;
  clientName: string;
  clientType: string;
};

export type GroupedReportRecurring = {
  contractId: string;
  contractNumber: string;
  clientName: string;
  supplierName: string;
  collaboratorId: string;
  collaboratorName: string;
  clientType: string;
  podPdr: string | null;
  amount: number;
  monthCount: number;
  periods: string[];
  paidMonthsLabel: string;
};

/** «Maggio, Giugno 2026 · Gennaio 2027» */
export function formatPaidMonthsLabel(periods: string[]): string {
  const byYear = new Map<string, string[]>();
  for (const p of [...new Set(periods)].sort()) {
    const [y, m] = p.split("-");
    if (!y || !m) continue;
    const label = REPORT_MONTH_LABELS[Number(m) - 1] ?? m;
    const arr = byYear.get(y) ?? [];
    arr.push(label);
    byYear.set(y, arr);
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([y, months]) => `${months.join(", ")} ${y}`)
    .join(" · ");
}

/** Una riga per contratto: somma importi e elenca i mesi pagati. */
export function groupReportRecurringByContract(
  rows: ReportRecurringRow[],
): GroupedReportRecurring[] {
  const map = new Map<string, ReportRecurringRow[]>();
  for (const r of rows) {
    const key =
      r.contractId ||
      `${r.contractNumber}|${r.clientName}|${r.supplierName}|${r.collaboratorId}`;
    const arr = map.get(key) ?? [];
    arr.push(r);
    map.set(key, arr);
  }

  return [...map.values()]
    .map((group) => {
      const first = group[0]!;
      const periods = [
        ...new Set(group.map((g) => g.settledPeriod || g.period)),
      ].sort();
      return {
        contractId: first.contractId,
        contractNumber: first.contractNumber,
        clientName: first.clientName,
        supplierName: first.supplierName,
        collaboratorId: first.collaboratorId,
        collaboratorName: first.collaboratorName,
        clientType: first.clientType,
        podPdr: first.podPdr,
        amount: group.reduce((s, g) => s + g.amount, 0),
        monthCount: periods.length,
        periods,
        paidMonthsLabel: formatPaidMonthsLabel(periods),
      };
    })
    .sort((a, b) => {
      const byClient = a.clientName.localeCompare(b.clientName, "it");
      if (byClient !== 0) return byClient;
      return a.supplierName.localeCompare(b.supplierName, "it");
    });
}

function periodsInRange(from: string, to: string, month?: string | null): string[] {
  // Mesi espliciti (anche multi: 2026-05|2026-06)
  if (month?.trim()) {
    const parts = month
      .split("|")
      .map((s) => s.trim())
      .filter((s) => /^\d{4}-\d{2}$/.test(s));
    if (parts.length > 0) return [...new Set(parts)].sort();
  }
  // from/to sono YYYY-MM-DD (già risolti come mese o periodo)
  const start = from.slice(0, 7);
  const end = to.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(start) || !/^\d{4}-\d{2}$/.test(end)) return [];
  const out: string[] = [];
  let [y, m] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Rate del mese di incasso del Report (stessa colonna di Provvigioni).
 * Incassato = PAID, Pagato = LIQUIDATED. Le annuali liquidate già in
 * archivio (tutte tranne l’ultima) restano fuori, come in elenco.
 */
export async function loadReportRecurringPaid(params: {
  from?: string | null;
  to?: string | null;
  month?: string | null;
  collaboratorId?: string | null;
  supplierId?: string | null;
  visibility: Prisma.ContractWhereInput;
  /**
   * Conservato per i chiamanti esistenti. Le rate Incassato/Pagato usano
   * sempre il mese di incasso (pagamento se c’è, altrimenti competenza).
   */
  competenceOnly?: boolean;
  /** Stato report: Incassato → PAID, Pagato → LIQUIDATED */
  stato?: string | null;
  /** Per test: data «oggi» (lag Helios). */
  now?: Date;
}): Promise<ReportRecurringRow[]> {
  const recurringWhere = buildReportRecurringWhere(params);
  if (!recurringWhere) return [];

  const { paid } = recurringStatusGroups(params.stato);
  let where: Prisma.RecurringMonthWhereInput = recurringWhere;
  if (paid.includes("LIQUIDATED")) {
    const collabIds = parseFilterList(params.collaboratorId);
    const supplierIds = parseFilterList(params.supplierId);
    const archived = await loadArchivedAnnualLiquidatedRateIds({
      AND: [
        params.visibility,
        { deletedAt: null },
        ...(collabIds.length === 1
          ? [{ collaboratorId: collabIds[0]! }]
          : collabIds.length > 1
            ? [{ collaboratorId: { in: collabIds } }]
            : []),
        ...(supplierIds.length === 1
          ? [{ supplierId: supplierIds[0]! }]
          : supplierIds.length > 1
            ? [{ supplierId: { in: supplierIds } }]
            : []),
      ],
    });
    if (archived.length > 0) {
      const CHUNK = 8000;
      const excluded: Prisma.RecurringMonthWhereInput[] = [];
      for (let i = 0; i < archived.length; i += CHUNK) {
        excluded.push({ id: { notIn: archived.slice(i, i + CHUNK) } });
      }
      where = { AND: [recurringWhere, ...excluded] };
    }
  }

  const rows = await prisma.recurringMonth.findMany({
    where,
    include: {
      contract: {
        select: {
          id: true,
          contractNumber: true,
          podPdr: true,
          pod: true,
          pdr: true,
          collaboratorId: true,
          collaborator: { select: { name: true } },
          supplier: { select: { name: true } },
          commission: { select: { expected: true } },
          client: {
            select: {
              type: true,
              firstName: true,
              lastName: true,
              companyName: true,
            },
          },
        },
      },
    },
    orderBy: [{ period: "asc" }, { settledPeriod: "asc" }],
    take: 10000,
  });

  return rows.map((m) => {
    const c = m.contract.client;
    const clientName =
      c.type === "AZIENDA"
        ? c.companyName?.trim() || "—"
        : [c.lastName, c.firstName].filter(Boolean).join(" ").trim() || "—";
    const rateAmount = m.amount == null ? 0 : Number(m.amount);
    const amount =
      rateAmount > 0
        ? rateAmount
        : effectiveGettone({
            expected: Number(m.contract.commission?.expected ?? 0),
            clientType: c.type,
            supplierName: m.contract.supplier.name,
          });
    return {
      id: m.id,
      contractId: m.contract.id,
      period: m.period,
      settledPeriod: m.settledPeriod,
      status: m.status,
      amount,
      paidAt: m.paidAt,
      contractNumber: m.contract.contractNumber,
      podPdr: (m.contract.podPdr || m.contract.pod || m.contract.pdr || "").trim(),
      collaboratorId: m.contract.collaboratorId,
      collaboratorName: m.contract.collaborator.name,
      supplierName: m.contract.supplier.name,
      clientName,
      clientType: c.type,
    };
  });
}

export function sumReportRecurring(rows: ReportRecurringRow[]): {
  count: number;
  amount: number;
} {
  return {
    count: rows.length,
    amount: rows.reduce((s, r) => s + r.amount, 0),
  };
}

/** Quota delle rate già liquidata al collaboratore (stato LIQUIDATED). */
export function sumReportRecurringLiquidato(rows: ReportRecurringRow[]): number {
  return rows
    .filter((r) => r.status === "LIQUIDATED")
    .reduce((s, r) => s + r.amount, 0);
}
