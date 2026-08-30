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

  const paidAmount = sumAmounts(paid);
  const liquidatedAmount = sumAmounts(liquidated);

  return {
    period,
    totalRates: rows.length,
    paidCount: paid.length,
    paidAmount,
    missingCount: missing.length,
    missingAmount: sumAmounts(missing),
    liquidatedCount: liquidated.length,
    liquidatedAmount,
    contractCount: new Set(rows.map((r) => r.contractId)).size,
  };
}

/** Incassato dal fornitore = PAID + LIQUIDATED (liquidato implica già incassato). */
export function incassatoCompetenceTotals(stats: CompetenceMonthStats): {
  count: number;
  amount: number;
} {
  return {
    count: stats.paidCount + stats.liquidatedCount,
    amount: stats.paidAmount + stats.liquidatedAmount,
  };
}

export type CompetenceSummaryView = {
  primaryLabel: string;
  primaryCount: number;
  primaryAmount: number;
  primaryTone: "emerald" | "indigo" | "amber";
  secondaryLabel: string | null;
  secondaryCount: number;
  secondaryAmount: number;
  overallAmount: number;
};

/** Riquadri riepilogo in base al filtro stato attivo. */
export function competenceSummaryForStato(
  stats: CompetenceMonthStats,
  stato?: string | null,
): CompetenceSummaryView {
  const incassato = incassatoCompetenceTotals(stats);
  const s = stato?.trim();

  if (s === "Pagato") {
    return {
      primaryLabel: "Pagate al collaboratore",
      primaryCount: stats.liquidatedCount,
      primaryAmount: stats.liquidatedAmount,
      primaryTone: "indigo",
      secondaryLabel: null,
      secondaryCount: 0,
      secondaryAmount: 0,
      overallAmount: stats.liquidatedAmount,
    };
  }
  if (s === "Incassato") {
    return {
      primaryLabel: "Incassate dal fornitore",
      primaryCount: incassato.count,
      primaryAmount: incassato.amount,
      primaryTone: "emerald",
      secondaryLabel: null,
      secondaryCount: 0,
      secondaryAmount: 0,
      overallAmount: incassato.amount,
    };
  }
  if (s === "Da incassare") {
    return {
      primaryLabel: "Da incassare",
      primaryCount: stats.missingCount,
      primaryAmount: stats.missingAmount,
      primaryTone: "amber",
      secondaryLabel: null,
      secondaryCount: 0,
      secondaryAmount: 0,
      overallAmount: stats.missingAmount,
    };
  }

  return {
    primaryLabel: "Incassate dal fornitore",
    primaryCount: incassato.count,
    primaryAmount: incassato.amount,
    primaryTone: "emerald",
    secondaryLabel: "Da incassare",
    secondaryCount: stats.missingCount,
    secondaryAmount: stats.missingAmount,
    overallAmount: incassato.amount + stats.missingAmount,
  };
}

export type ProvvigioniVista = "tutti" | "ut" | "mensile" | "annuale";

export function parseProvvigioniVista(raw: string | null | undefined): ProvvigioniVista {
  if (raw === "ut") return "tutti";
  if (raw === "annuale") return "annuale";
  if (raw === "mensile" || raw === "ricorrente") return "mensile";
  return "tutti";
}

/** Vista per UI tab (3 schede). */
export function parseProvvigioniTab(
  raw: string | null | undefined,
): "tutti" | "mensile" | "annuale" {
  const v = parseProvvigioniVista(raw);
  if (v === "mensile") return "mensile";
  if (v === "annuale") return "annuale";
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
