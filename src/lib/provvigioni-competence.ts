/**
 * Statistiche e filtri per mese di competenza (rate ricorrenti M/R).
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { addMonths, toPeriod } from "@/lib/recurring";

export type CompetenceMonthStats = {
  period: string;
  totalRates: number;
  paidCount: number;
  paidAmount: number;
  missingCount: number;
  missingAmount: number;
  liquidatedCount: number;
  liquidatedAmount: number;
  contractCount: number;
};

const MISSING_STATUSES = ["MISSING", "PENDING", "ERROR_UNPAID"] as const;

function sumAmounts(
  rows: Array<{ amount: { toString(): string } | null }>,
): number {
  return rows.reduce((s, r) => s + Number(r.amount?.toString() ?? 0), 0);
}

/** Ultimi N mesi per selettore competenza (dal mese scorso indietro). */
export function competenceMonthOptions(count = 14): string[] {
  const out: string[] = [];
  const base = addMonths(toPeriod(new Date()), -1);
  let cur = base;
  for (let i = 0; i < count; i++) {
    out.push(cur);
    cur = addMonths(cur, -1);
  }
  return out;
}

export async function loadCompetenceMonthStats(
  period: string,
  contractWhere: Prisma.ContractWhereInput,
): Promise<CompetenceMonthStats> {
  const rows = await prisma.recurringMonth.findMany({
    where: {
      period,
      status: { not: "CLOSED" },
      contract: contractWhere,
    },
    select: {
      contractId: true,
      status: true,
      amount: true,
    },
  });

  const paid = rows.filter((r) => r.status === "PAID");
  const missing = rows.filter((r) =>
    (MISSING_STATUSES as readonly string[]).includes(r.status),
  );
  const liquidated = rows.filter((r) => r.status === "LIQUIDATED");

  return {
    period,
    totalRates: rows.length,
    paidCount: paid.length,
    paidAmount: sumAmounts(paid),
    missingCount: missing.length,
    missingAmount: sumAmounts(missing),
    liquidatedCount: liquidated.length,
    liquidatedAmount: sumAmounts(liquidated),
    contractCount: new Set(rows.map((r) => r.contractId)).size,
  };
}

export type ProvvigioniVista = "tutti" | "ut" | "mensile" | "annuale";

export function parseProvvigioniVista(raw: string | null | undefined): ProvvigioniVista {
  if (raw === "ut") return "ut";
  if (raw === "annuale") return "annuale";
  if (raw === "mensile" || raw === "ricorrente") return "mensile";
  return "tutti";
}

export function vistaToRecurrenceMode(
  vista: ProvvigioniVista,
): "all" | "exclude" | "monthly" | "annual" {
  if (vista === "ut") return "exclude";
  if (vista === "mensile") return "monthly";
  if (vista === "annuale") return "annual";
  return "all";
}
