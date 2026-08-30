/**
 * Totali finanziari Provvigioni: incassato, da incassare, pagato.
 * Usa gli stessi filtri Prisma della lista (buildProvvigioniContractWhere + stato).
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buildProvvigioniContractWhere,
  recurringWhereOr,
  type ProvvigioniFilters,
} from "@/lib/provvigioni-filters";

export type ProvvigioniFinancialSummary = {
  incassatoCount: number;
  incassatoAmount: number;
  daIncassareCount: number;
  daIncassareAmount: number;
  pagatoCount: number;
  pagatoAmount: number;
};

const UT_ONLY: Prisma.ContractWhereInput = {
  OR: [
    { recurrence: null },
    { recurrence: { equals: "" } },
    { NOT: { OR: recurringWhereOr } },
  ],
};

const MISSING = ["MISSING", "PENDING", "ERROR_UNPAID"] as const;

function num(value: Prisma.Decimal | number | null | undefined): number {
  return Number(value?.toString() ?? 0) || 0;
}

async function sumAmountForStato(
  where: Prisma.ContractWhereInput,
  stato: "Incassato" | "Da incassare" | "Pagato",
  competencePeriod: string | null,
): Promise<number> {
  const periodFilter = competencePeriod ? { period: competencePeriod } : {};

  if (stato === "Incassato") {
    const [recurring, ut] = await Promise.all([
      prisma.recurringMonth.aggregate({
        where: {
          status: "PAID",
          ...periodFilter,
          contract: where,
        },
        _sum: { amount: true },
      }),
      prisma.commission.aggregate({
        where: {
          contract: { AND: [where, UT_ONLY] },
        },
        _sum: { expected: true },
      }),
    ]);
    return num(recurring._sum.amount) + num(ut._sum.expected);
  }

  if (stato === "Da incassare") {
    const [recurring, ut] = await Promise.all([
      prisma.recurringMonth.aggregate({
        where: {
          status: { in: [...MISSING] },
          ...periodFilter,
          contract: where,
        },
        _sum: { amount: true },
      }),
      prisma.commission.aggregate({
        where: {
          contract: { AND: [where, UT_ONLY] },
        },
        _sum: { expected: true },
      }),
    ]);
    return num(recurring._sum.amount) + num(ut._sum.expected);
  }

  const [recurring, ut] = await Promise.all([
    prisma.recurringMonth.aggregate({
      where: {
        status: "LIQUIDATED",
        ...periodFilter,
        contract: where,
      },
      _sum: { amount: true },
    }),
    prisma.commission.aggregate({
      where: {
        contract: { AND: [where, { status: "PROVVIGIONE_LIQUIDATA" }] },
      },
      _sum: { expected: true },
    }),
  ]);
  return num(recurring._sum.amount) + num(ut._sum.expected);
}

async function summaryForStato(
  base: Omit<ProvvigioniFilters, "stato">,
  stato: "Incassato" | "Da incassare" | "Pagato",
  competencePeriod: string | null,
): Promise<{ count: number; amount: number }> {
  const where = buildProvvigioniContractWhere({
    ...base,
    stato,
    competencePeriod,
  });
  const [count, amount] = await Promise.all([
    prisma.contract.count({ where }),
    sumAmountForStato(where, stato, competencePeriod),
  ]);
  return { count, amount };
}

export type SummaryVista = "tutti" | "mensile" | "annuale";

/**
 * Totali allineati ai filtri lista (stessa logica del click sulle card).
 */
export async function loadProvvigioniFinancialSummary(
  base: Omit<ProvvigioniFilters, "stato">,
  _vista: SummaryVista,
  competencePeriod: string | null,
): Promise<ProvvigioniFinancialSummary> {
  const [incassato, daIncassare, pagato] = await Promise.all([
    summaryForStato(base, "Incassato", competencePeriod),
    summaryForStato(base, "Da incassare", competencePeriod),
    summaryForStato(base, "Pagato", competencePeriod),
  ]);

  return {
    incassatoCount: incassato.count,
    incassatoAmount: incassato.amount,
    daIncassareCount: daIncassare.count,
    daIncassareAmount: daIncassare.amount,
    pagatoCount: pagato.count,
    pagatoAmount: pagato.amount,
  };
}
