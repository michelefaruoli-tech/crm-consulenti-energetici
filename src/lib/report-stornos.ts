/**
 * Storni gettone (commission.stornoDate / stornoAmount) da includere nei Report.
 *
 * Regola: il mese dello storno (es. 08/2026) deve entrare nel Report «Incassato»
 * come importo negativo, e detrarre dal totale provvigioni del mese.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { clientDisplayName } from "@/lib/utils";
import { reportDateRange, resolveReportPeriod } from "@/lib/report-filters";

export type ReportStornoRow = {
  commissionId: string;
  contractId: string;
  contractNumber: string;
  stornoDate: Date;
  amount: number;
  collaboratorId: string;
  collaboratorName: string;
  supplierName: string;
  clientName: string;
  /** Mese storno YYYY-MM */
  period: string;
};

function toPeriodKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function loadReportStornos(params: {
  from?: string | null;
  to?: string | null;
  month?: string | null;
  collaboratorId?: string | null;
  supplierId?: string | null;
  visibility: Prisma.ContractWhereInput;
}): Promise<ReportStornoRow[]> {
  const period = resolveReportPeriod(params);
  const { dateFrom, dateTo } = reportDateRange(period.from, period.to);

  const rows = await prisma.commission.findMany({
    where: {
      stornoDate: { gte: dateFrom, lte: dateTo },
      stornoAmount: { not: null },
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
    select: {
      id: true,
      stornoDate: true,
      stornoAmount: true,
      contract: {
        select: {
          id: true,
          contractNumber: true,
          collaboratorId: true,
          collaborator: { select: { name: true } },
          supplier: { select: { name: true } },
          client: {
            select: {
              type: true,
              companyName: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      },
    },
    orderBy: { stornoDate: "asc" },
  });

  return rows
    .filter((r) => r.stornoDate != null)
    .map((r) => {
      const amount = Number(r.stornoAmount ?? 0);
      // Sempre negativo in report (detrazione)
      const signed = amount === 0 ? 0 : amount < 0 ? amount : -Math.abs(amount);
      return {
        commissionId: r.id,
        contractId: r.contract.id,
        contractNumber: r.contract.contractNumber,
        stornoDate: r.stornoDate!,
        amount: signed,
        collaboratorId: r.contract.collaboratorId,
        collaboratorName: r.contract.collaborator.name,
        supplierName: r.contract.supplier.name,
        clientName: clientDisplayName(r.contract.client),
        period: toPeriodKey(r.stornoDate!),
      };
    });
}

export function sumReportStornos(rows: ReportStornoRow[]): {
  count: number;
  amount: number;
} {
  return {
    count: rows.length,
    amount: rows.reduce((s, r) => s + r.amount, 0),
  };
}
