/**
 * Totali finanziari Provvigioni — stessa query e importi della lista.
 */
import type { Prisma } from "@/generated/prisma/client";
import {
  buildProvvigioniListWhere,
  type ProvvigioniFilters,
  type ProvvigioniListFocus,
} from "@/lib/provvigioni-filters";
import {
  countExpandedForStatoCard,
  getRecurringExpandMode,
  sumExpandedAmountForStato,
} from "@/lib/provvigioni-rows";

export type ProvvigioniFinancialSummary = {
  incassatoCount: number;
  incassatoAmount: number;
  daIncassareCount: number;
  daIncassareAmount: number;
  pagatoCount: number;
  pagatoAmount: number;
};

type StatoCard = "Incassato" | "Da incassare" | "Pagato";

export type ProvvigioniSummaryContext = {
  focus?: ProvvigioniListFocus | null;
  effectiveCompetence?: string;
  applyCompetenceToList: boolean;
  viewingAllPeriods?: boolean;
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
  const viewingAllPeriods = ctx.viewingAllPeriods ?? !ctx.applyCompetenceToList;
  const expandMode = getRecurringExpandMode(
    stato,
    viewingAllPeriods,
    ctx.effectiveCompetence,
  );

  if (
    ctx.activeStato?.trim() === stato &&
    ctx.activeListWhere &&
    ctx.activeListTotal !== undefined
  ) {
    return {
      count: ctx.activeListTotal,
      amount: await sumExpandedAmountForStato(
        ctx.activeListWhere,
        expandMode,
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
    countExpandedForStatoCard(
      where,
      stato,
      viewingAllPeriods,
      ctx.effectiveCompetence,
    ),
    sumExpandedAmountForStato(where, expandMode, competenceForAmount),
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
