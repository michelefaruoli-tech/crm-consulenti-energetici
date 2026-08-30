/**
 * Totali finanziari Provvigioni — stessa query e importi della lista.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buildProvvigioniListWhere,
  type ProvvigioniFilters,
  type ProvvigioniListFocus,
} from "@/lib/provvigioni-filters";
import { provvigioneDisplayAmount } from "@/lib/provvigioni-stato";

export type ProvvigioniFinancialSummary = {
  incassatoCount: number;
  incassatoAmount: number;
  daIncassareCount: number;
  daIncassareAmount: number;
  pagatoCount: number;
  pagatoAmount: number;
};

type StatoCard = "Incassato" | "Da incassare" | "Pagato";

const contractAmountSelect = {
  client: { select: { type: true } },
  supplier: { select: { name: true } },
  commission: { select: { expected: true } },
  recurringMonths: {
    select: { period: true, amount: true },
  },
} as const;

/** Somma importi colonna Gettone per tutti i contratti del filtro. */
export async function sumAmountForStato(
  where: Prisma.ContractWhereInput,
  _stato: StatoCard,
  competencePeriod: string | null,
): Promise<number> {
  const contracts = await prisma.contract.findMany({
    where,
    select: contractAmountSelect,
  });

  return contracts.reduce((sum, c) => {
    return (
      sum +
      provvigioneDisplayAmount({
        commissionExpected: Number(c.commission?.expected ?? 0),
        clientType: c.client.type,
        supplierName: c.supplier.name,
        recurringMonths: c.recurringMonths,
        competencePeriod,
      })
    );
  }, 0);
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
