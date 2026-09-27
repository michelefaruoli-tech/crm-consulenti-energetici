/**
 * Totali finanziari Provvigioni — stessa query e importi della lista.
 */
import type { Prisma } from "@/generated/prisma/client";
import {
  buildProvvigioniListWhere,
  isBucketSpecificFocus,
  isIncassatoDaLiquidareFocus,
  isUtDaIncassareFocus,
  provvigioneStatoWhere,
  recurringAnnualWhereOr,
  recurringMonthlyWhereOr,
  type ProvvigioniFilters,
  type ProvvigioniListFocus,
} from "@/lib/provvigioni-filters";
import { canonicalizeProvvigioneStato } from "@/lib/provvigioni-stato";
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
  /** Totale Da incassare (UT+M+R) — compat / somma split. */
  daIncassareCount: number;
  daIncassareAmount: number;
  /** P1.1 B3 — Da incassare solo una tantum (UT). */
  daIncassareUtCount: number;
  daIncassareUtAmount: number;
  /** P1.1 B3 — Da incassare solo ricorrenti mensili (M). */
  daIncassareMCount: number;
  daIncassareMAmount: number;
  /** P1.1 B3 — Da incassare solo ricorrenti annuali (R). */
  daIncassareRCount: number;
  daIncassareRAmount: number;
  pagatoCount: number;
  pagatoAmount: number;
};

type StatoCard = "Incassato" | "Da incassare" | "Pagato";
type DaIncassareKind = "all" | "UT" | "M" | "R";

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

function isActiveDaIncassareCard(
  kind: DaIncassareKind,
  ctx: ProvvigioniSummaryContext,
): boolean {
  // Solo focus B3: la lista è già UT+Da incassare → riusa activeListWhere.
  // Con `stato=Da incassare` generico la lista include UT+M+R: non riusarla
  // sulla card UT (conteggio sbagliato).
  return kind === "UT" && isUtDaIncassareFocus(ctx.focus);
}

async function summaryForStato(
  base: Omit<ProvvigioniFilters, "stato">,
  stato: StatoCard,
  ctx: ProvvigioniSummaryContext,
  opts?: { daIncassareKind?: DaIncassareKind },
): Promise<{ count: number; amount: number }> {
  const competenceForAmount = ctx.applyCompetenceToList
    ? ctx.effectiveCompetence ?? null
    : null;
  const viewingAllPeriods = ctx.viewingAllPeriods ?? !ctx.applyCompetenceToList;
  const expandMode =
    ctx.allowExpand === false
      ? null
      : getRecurringExpandMode(stato, viewingAllPeriods, ctx.effectiveCompetence);

  const kind = opts?.daIncassareKind ?? "all";
  const activeCanon = canonicalizeProvvigioneStato(ctx.activeStato?.trim() ?? "");
  const isActiveIncassato =
    stato === "Incassato" &&
    (activeCanon === "Incassato" || isIncassatoDaLiquidareFocus(ctx.focus));
  const isActivePagato = stato === "Pagato" && activeCanon === "Pagato";
  const isActiveDaIncassare =
    stato === "Da incassare" && isActiveDaIncassareCard(kind, ctx);

  // Card attiva: usa dati già calcolati per il conteggio; espansi solo se necessario.
  // Solo per bucket «all» / focus UT (stesso where della lista).
  if (
    (isActiveIncassato || isActivePagato || isActiveDaIncassare) &&
    (kind === "all" || (kind === "UT" && isUtDaIncassareFocus(ctx.focus))) &&
    ctx.activeListWhere &&
    ctx.activeListTotal !== undefined
  ) {
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

  /**
   * Focus B2/B3 bucket-specific: non AND-are sulle altre card
   * (altrimenti totali incompatibili diventano 0).
   */
  const summaryFocus = isBucketSpecificFocus(ctx.focus)
    ? undefined
    : ctx.focus;

  /**
   * Split UT/M/R: sempre recurrenceMode=all + AND su recurrenceKind.
   * Non usare `monthly` con stato Da incassare: quella modalità OR-a anche
   * `IN_ATTESA_PAGAMENTO` (anche UT) e farebbe doppio conteggio con la card UT.
   */
  const whereBase = buildProvvigioniListWhere({
    filters: {
      ...base,
      stato,
      recurrenceMode: "all",
      competencePeriod: ctx.effectiveCompetence,
    },
    focus: summaryFocus,
    effectiveCompetence: ctx.effectiveCompetence,
    applyCompetenceToList: ctx.applyCompetenceToList,
  });
  const kindClause: Prisma.ContractWhereInput | null =
    kind === "UT"
      ? { recurrenceKind: "UT" }
      : kind === "M"
        ? { OR: recurringMonthlyWhereOr }
        : kind === "R"
          ? { OR: recurringAnnualWhereOr }
          : null;
  const where: Prisma.ContractWhereInput = kindClause
    ? { AND: [whereBase, kindClause] }
    : whereBase;

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

/**
 * Totali card Provvigioni.
 * P1.1 B3: split Da incassare in UT / M / R (no doppio conteggio M vs UT/R).
 * Card storno rimandata (D3 → P1.2/P1.3).
 */
export async function loadProvvigioniFinancialSummary(
  base: Omit<ProvvigioniFilters, "stato">,
  _vista: SummaryVista,
  ctx: ProvvigioniSummaryContext,
): Promise<ProvvigioniFinancialSummary> {
  // Eseguire in serie per non saturare le connessioni Neon HTTP con troppe query parallele.
  // Split UT/M/R: base senza recurrenceMode della vista corrente, così i totali
  // card restano confrontabili indipendentemente dal tab Tutti/M/R.
  const baseAllKinds: Omit<ProvvigioniFilters, "stato"> = {
    ...base,
    recurrenceMode: "all",
  };

  const incassato = await summaryForStato(baseAllKinds, "Incassato", ctx);
  const daIncassareUt = await summaryForStato(baseAllKinds, "Da incassare", ctx, {
    daIncassareKind: "UT",
  });
  const daIncassareM = await summaryForStato(baseAllKinds, "Da incassare", ctx, {
    daIncassareKind: "M",
  });
  const daIncassareR = await summaryForStato(baseAllKinds, "Da incassare", ctx, {
    daIncassareKind: "R",
  });
  const pagato = await summaryForStato(baseAllKinds, "Pagato", ctx);

  return {
    incassatoCount: incassato.count,
    incassatoAmount: incassato.amount,
    daIncassareUtCount: daIncassareUt.count,
    daIncassareUtAmount: daIncassareUt.amount,
    daIncassareMCount: daIncassareM.count,
    daIncassareMAmount: daIncassareM.amount,
    daIncassareRCount: daIncassareR.count,
    daIncassareRAmount: daIncassareR.amount,
    daIncassareCount:
      daIncassareUt.count + daIncassareM.count + daIncassareR.count,
    daIncassareAmount:
      daIncassareUt.amount + daIncassareM.amount + daIncassareR.amount,
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
  /** P1.1 B3 — solo UT da incassare (sottoinsieme di daIncassare). */
  daIncassareUt: number;
  /** P1.1 B3 — solo annuali R da incassare (sottoinsieme di daIncassare). */
  daIncassareR: number;
  /** Rate mensili ricorrenti (M) ancora da incassare (MISSING/PENDING/
   * ERROR_UNPAID), stesso gating della lista Provvigioni (lag Helios M+2
   * incluso). Contratti mensili non Helios senza ancora nessuna rata generata
   * sono comunque contati con il gettone previsto (vedi `neverSyncedMonthlyWhere`). */
  ricorrenti: number;
};

/**
 * Totali finanziari per le card della Dashboard.
 *
 * Qui si riusa la STESSA logica della lista (stessa definizione di stato,
 * stesso gating Helios M+2, stessa gestione dei gettoni una tantum senza
 * rata) per i numeri sorgente, poi si separa la quota mensile ricorrente
 * per card distinte senza doppio conteggio (regola Michele).
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
  const daIncassareUtWhere: Prisma.ContractWhereInput = {
    AND: [daIncassareWhere, { recurrenceKind: "UT" }],
  };
  const daIncassareRWhere: Prisma.ContractWhereInput = {
    AND: [daIncassareWhere, { OR: recurringAnnualWhereOr }],
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
  const daIncassareUt = await sumExpandedAmountForStato(
    daIncassareUtWhere,
    "da-incassare",
    null,
    "Da incassare",
  );
  const daIncassareR = await sumExpandedAmountForStato(
    daIncassareRWhere,
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
    daIncassareUt,
    daIncassareR,
    ricorrenti,
  };
}
