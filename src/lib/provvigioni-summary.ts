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
  countExpandedListRows,
  getRecurringExpandMode,
  sumExpandedAmountForStato,
} from "@/lib/provvigioni-rows";
import { prisma } from "@/lib/prisma";

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
  /** Se false, card e importi usano 1 riga/contratto (no expand rate). */
  allowExpand?: boolean;
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
  const expandMode =
    ctx.allowExpand === false
      ? null
      : getRecurringExpandMode(stato, viewingAllPeriods, ctx.effectiveCompetence);

  const isActive = ctx.activeStato?.trim() === stato;

  // Card attiva: usa dati già calcolati per il conteggio; espansi solo se necessario.
  if (isActive && ctx.activeListWhere && ctx.activeListTotal !== undefined) {
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
    expandMode
      ? countExpandedListRows(where, expandMode)
      : prisma.contract.count({ where }),
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
  // Eseguire in serie per non saturare le connessioni Neon HTTP con troppe query parallele.
  const incassato = await summaryForStato(base, "Incassato", ctx);
  const daIncassare = await summaryForStato(base, "Da incassare", ctx);
  const pagato = await summaryForStato(base, "Pagato", ctx);

  return {
    incassatoCount: incassato.count,
    incassatoAmount: incassato.amount,
    daIncassareCount: daIncassare.count,
    daIncassareAmount: daIncassare.amount,
    pagatoCount: pagato.count,
    pagatoAmount: pagato.amount,
  };
}
