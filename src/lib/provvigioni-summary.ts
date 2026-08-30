/**
 * Totali finanziari Provvigioni — stessa query Prisma della lista.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buildProvvigioniListWhere,
  recurringWhereOr,
  type ProvvigioniFilters,
  type ProvvigioniListFocus,
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

type StatoCard = "Incassato" | "Da incassare" | "Pagato";

function num(value: Prisma.Decimal | number | null | undefined): number {
  return Number(value?.toString() ?? 0) || 0;
}

export async function sumAmountForStato(
  where: Prisma.ContractWhereInput,
  stato: StatoCard,
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

export type ProvvigioniSummaryContext = {
  focus?: ProvvigioniListFocus | null;
  effectiveCompetence?: string;
  applyCompetenceToList: boolean;
  /** Lista corrente: allinea la card dello stato attivo */
  activeStato?: string | null;
  activeListWhere?: Prisma.ContractWhereInput;
  activeListTotal?: number;
};

async function summaryForStato(
  base: Omit<ProvvigioniFilters, "stato">,
  stato: StatoCard,
  ctx: ProvvigioniSummaryContext,
): Promise<{ count: number; amount: number }> {
  const competenceForAmount = ctx.applyCompetenceToList
    ? ctx.effectiveCompetence ?? null
    : null;

  if (
    ctx.activeStato?.trim() === stato &&
    ctx.activeListWhere &&
    ctx.activeListTotal !== undefined
  ) {
    return {
      count: ctx.activeListTotal,
      amount: await sumAmountForStato(
        ctx.activeListWhere,
        stato,
        competenceForAmount,
      ),
    };
  }

  const where = buildProvvigioniListWhere({
    filters: {
      ...base,
      stato,
      competencePeriod: ctx.effectiveCompetence,
    },
    focus: ctx.focus,
    effectiveCompetence: ctx.effectiveCompetence,
    applyCompetenceToList: ctx.applyCompetenceToList,
  });

  const [count, amount] = await Promise.all([
    prisma.contract.count({ where }),
    sumAmountForStato(where, stato, competenceForAmount),
  ]);
  return { count, amount };
}

export type SummaryVista = "tutti" | "mensile" | "annuale";

export async function loadProvvigioniFinancialSummary(
  base: Omit<ProvvigioniFilters, "stato">,
  _vista: SummaryVista,
  ctx: ProvvigioniSummaryContext,
): Promise<ProvvigioniFinancialSummary> {
  const [incassato, daIncassare, pagato] = await Promise.all([
    summaryForStato(base, "Incassato", ctx),
    summaryForStato(base, "Da incassare", ctx),
    summaryForStato(base, "Pagato", ctx),
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
