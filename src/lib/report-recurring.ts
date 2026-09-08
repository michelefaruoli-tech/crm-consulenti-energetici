/**
 * Rate ricorrenti (RecurringMonth PAID) da includere nei Report.
 * Il Report contratti usa solo Commission; le rate mensili Helios (€4/€6)
 * vivono in RecurringMonth e vanno sommate a parte.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  parseFilterList,
  reportRecurringStatusWhere,
  resolveReportPeriod,
} from "@/lib/report-filters";
import { REPORT_MONTH_LABELS } from "@/lib/report-month";

export type ReportRecurringRow = {
  id: string;
  contractId: string;
  period: string;
  settledPeriod: string | null;
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
      const periods = [...new Set(group.map((g) => g.period))].sort();
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
 * Rate ricorrenti nel periodo Report:
 * - competenza (`period`) nel range, oppure
 * - mese bonifico (`settledPeriod`) nel range
 *
 * Così «ricorrenti giugno» entrano sia se giugno è la competenza
 * sia se giugno è il mese del rendiconto.
 */
export async function loadReportRecurringPaid(params: {
  from?: string | null;
  to?: string | null;
  month?: string | null;
  collaboratorId?: string | null;
  supplierId?: string | null;
  visibility: Prisma.ContractWhereInput;
  /**
   * Report «Incassato»: usa solo il mese competenza (`period`).
   * Evita rate vecchie (es. 2025-05) incluse solo perché il bonifico è a luglio.
   */
  competenceOnly?: boolean;
  /** Stato report: Incassato → PAID, Pagato → LIQUIDATED */
  stato?: string | null;
}): Promise<ReportRecurringRow[]> {
  const period = resolveReportPeriod(params);
  const periods = periodsInRange(period.from, period.to, period.month);
  if (periods.length === 0) return [];

  const collabIds = parseFilterList(params.collaboratorId);
  const supplierIds = parseFilterList(params.supplierId);

  const periodWhere: Prisma.RecurringMonthWhereInput = params.competenceOnly
    ? { period: { in: periods } }
    : {
        OR: [{ period: { in: periods } }, { settledPeriod: { in: periods } }],
      };

  const rows = await prisma.recurringMonth.findMany({
    where: {
      ...reportRecurringStatusWhere(params.stato),
      ...periodWhere,
      contract: {
        AND: [
          params.visibility,
          { deletedAt: null },
          { isHistorical: false },
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
      },
    },
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
    return {
      id: m.id,
      contractId: m.contract.id,
      period: m.period,
      settledPeriod: m.settledPeriod,
      amount: Number(m.amount ?? 0),
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
