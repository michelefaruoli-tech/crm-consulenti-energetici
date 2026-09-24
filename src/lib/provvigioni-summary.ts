/**
 * Totali finanziari Provvigioni — stessa query e importi della lista.
 */
import type { Prisma } from "@/generated/prisma/client";
import {
  buildProvvigioniListWhere,
  provvigioneStatoWhere,
  recurringMonthlyWhereOr,
  type ProvvigioniFilters,
  type ProvvigioniListFocus,
} from "@/lib/provvigioni-filters";
import {
  countExpandedListRows,
  getRecurringExpandMode,
  sumExpandedAmountForStato,
  type ProvvigioniRowFilterScope,
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
  /** Filtri di colonna che valgono su rata / riga contratto (mese rif., gettone…). */
  rowScope?: ProvvigioniRowFilterScope;
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
        stato,
        ctx.rowScope,
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
      ? countExpandedListRows(where, expandMode, stato, ctx.rowScope)
      : prisma.contract.count({ where }),
    sumExpandedAmountForStato(
      where,
      expandMode,
      competenceForAmount,
      stato,
      ctx.rowScope,
    ),
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

export type DashboardMoneyTotals = {
  /** Ricevute + da incassare (una tantum e annuali). Non include le mensilità
   * ricorrenti, per non farle contare due volte insieme a «Ricorrenti mensili». */
  complessivo: number;
  /** Provvigioni già incassate dal fornitore — tutti i tipi (una tantum, annuali, mensili). */
  incassato: number;
  /** Gettoni una tantum e annuali (R) non ancora incassati. NON include le rate
   * mensili ricorrenti (M): quelle sono in «ricorrenti», per restare un totale
   * separato come richiesto (le due card non si devono sovrapporre). */
  daIncassare: number;
  /** Rate mensili ricorrenti (M) ancora da incassare (MISSING/PENDING/
   * ERROR_UNPAID), stesso gating della lista Provvigioni (lag Helios M+2
   * incluso). Contratti mensili non Helios senza ancora nessuna rata generata
   * sono comunque contati con il gettone previsto (vedi `neverSyncedMonthlyWhere`). */
  ricorrenti: number;
};

/**
 * Totali finanziari per le 4 card della Dashboard.
 *
 * Prima di questa funzione la Dashboard usava un calcolo separato basato
 * solo su `Contract.collectionDate` (`sumProvvigioniTotals`, rimossa): non
 * considerava affatto le rate `RecurringMonth` dei contratti ricorrenti, per
 * cui contratti realmente «Da incassare» comparivano a 0,00 € — il calcolo
 * era completamente disallineato dalla lista Provvigioni (che invece usa
 * `provvigioneStatoWhere` + l'espansione a rata di `provvigioni-rows.ts`).
 *
 * Qui si riusa la STESSA logica della lista (stessa definizione di stato,
 * stesso gating Helios M+2, stessa gestione dei gettoni una tantum senza
 * rata) per i 3 numeri sorgente, poi si separa la quota mensile ricorrente
 * per due card distinte senza doppio conteggio.
 */
export async function loadDashboardMoneyTotals(
  contractWhere: Prisma.ContractWhereInput,
): Promise<DashboardMoneyTotals> {
  const incassatoWhere: Prisma.ContractWhereInput = {
    AND: [contractWhere, provvigioneStatoWhere("Incassato") ?? {}],
  };
  const daIncassareWhere: Prisma.ContractWhereInput = {
    AND: [contractWhere, provvigioneStatoWhere("Da incassare") ?? {}],
  };
  const daIncassareMensiliWhere: Prisma.ContractWhereInput = {
    AND: [daIncassareWhere, { OR: recurringMonthlyWhereOr }],
  };

  // In serie (non Promise.all): Neon HTTP satura con troppe query in parallelo
  // (stesso motivo di `loadProvvigioniFinancialSummary` qui sopra).
  const incassato = await sumExpandedAmountForStato(
    incassatoWhere,
    "incassato",
    null,
    "Incassato",
  );
  const daIncassareTotale = await sumExpandedAmountForStato(
    daIncassareWhere,
    "da-incassare",
    null,
    "Da incassare",
  );
  const ricorrenti = await sumExpandedAmountForStato(
    daIncassareMensiliWhere,
    "da-incassare",
    null,
    "Da incassare",
  );

  // Sottrazione invece di ricalcolo indipendente: garantisce che le due card
  // non si sovrappongano mai (stessa fonte, stesso filtro base).
  const daIncassare = Math.max(0, daIncassareTotale - ricorrenti);

  return {
    complessivo: incassato + daIncassare,
    incassato,
    daIncassare,
    ricorrenti,
  };
}
