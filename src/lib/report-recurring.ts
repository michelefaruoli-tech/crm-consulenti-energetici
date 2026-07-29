/**
 * Rate ricorrenti (RecurringMonth PAID) da includere nei Report.
 * Il Report contratti usa solo Commission; le rate mensili Helios (€4/€6)
 * vivono in RecurringMonth e vanno sommate a parte.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { toPeriod } from "@/lib/recurring";
import { resolveReportPeriod, reportDateRange } from "@/lib/report-filters";

export type ReportRecurringRow = {
  id: string;
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

function periodsInRange(from: string, to: string): string[] {
  const { dateFrom, dateTo } = reportDateRange(from, to);
  const out: string[] = [];
  const cur = new Date(dateFrom.getFullYear(), dateFrom.getMonth(), 1);
  const end = new Date(dateTo.getFullYear(), dateTo.getMonth(), 1);
  while (cur <= end) {
    out.push(toPeriod(cur));
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

/**
 * Rate PAID nel periodo Report:
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
}): Promise<ReportRecurringRow[]> {
  const period = resolveReportPeriod(params);
  const periods = periodsInRange(period.from, period.to);
  if (periods.length === 0) return [];

  const rows = await prisma.recurringMonth.findMany({
    where: {
      status: "PAID",
      OR: [{ period: { in: periods } }, { settledPeriod: { in: periods } }],
      contract: {
        AND: [
          params.visibility,
          { deletedAt: null },
          { isHistorical: false },
          ...(params.collaboratorId
            ? [{ collaboratorId: params.collaboratorId }]
            : []),
          ...(params.supplierId ? [{ supplierId: params.supplierId }] : []),
        ],
      },
    },
    include: {
      contract: {
        select: {
          contractNumber: true,
          podPdr: true,
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
      period: m.period,
      settledPeriod: m.settledPeriod,
      amount: Number(m.amount ?? 0),
      paidAt: m.paidAt,
      contractNumber: m.contract.contractNumber,
      podPdr: m.contract.podPdr,
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
