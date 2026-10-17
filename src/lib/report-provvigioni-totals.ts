/**
 * Allineamento totali tra Report e Provvigioni.
 * Provvigioni usa `sumExpandedAmountForStato` senza filtro competenza;
 * il Report con gli stessi filtri deve chiudere sulla stessa cifra.
 */
import type { Prisma } from "@/generated/prisma/client";
import { parseFilterList } from "@/lib/filter-list";
import {
  buildProvvigioniListWhere,
  type ProvvigioniFilters,
} from "@/lib/provvigioni-filters";
import {
  getRecurringExpandMode,
  sumExpandedAmountForStato,
} from "@/lib/provvigioni-rows";
export type ReportProvvigioniAlignInput = {
  sessionUserId: string;
  canViewAll: boolean;
  visibility: Prisma.ContractWhereInput;
  collaboratorId?: string | null;
  supplierIds?: string[];
};

function listWhereForStato(
  input: ReportProvvigioniAlignInput,
  stato: "Da incassare" | "Incassato",
): Prisma.ContractWhereInput {
  const collabIds = parseFilterList(input.collaboratorId);
  const collab =
    collabIds.length > 0 ? collabIds.join("|") : undefined;

  const baseFilters: Omit<ProvvigioniFilters, "stato"> = {
    canViewAll: input.canViewAll,
    sessionUserId: input.sessionUserId,
    collab,
    recurrenceMode: "all",
    visibility: input.visibility,
  };

  let where = buildProvvigioniListWhere({
    filters: { ...baseFilters, stato },
    applyCompetenceToList: false,
  });

  const supplierIds = input.supplierIds ?? [];
  if (supplierIds.length === 1) {
    where = { AND: [where, { supplierId: supplierIds[0]! }] };
  } else if (supplierIds.length > 1) {
    where = { AND: [where, { supplierId: { in: supplierIds } }] };
  }
  return where;
}

/** Stesso importo della card «Da incassare» in Provvigioni (tutti i periodi). */
export async function sumDaIncassareLikeProvvigioni(
  input: ReportProvvigioniAlignInput,
): Promise<number> {
  const where = listWhereForStato(input, "Da incassare");
  const expandMode = getRecurringExpandMode("Da incassare", true, undefined);
  return sumExpandedAmountForStato(
    where,
    expandMode,
    null,
    "Da incassare",
  );
}

/** Stesso importo della card «Incassato da liquidare» (tutti i periodi). */
export async function sumIncassatoLikeProvvigioni(
  input: ReportProvvigioniAlignInput,
): Promise<number> {
  const where = listWhereForStato(input, "Incassato");
  const expandMode = getRecurringExpandMode("Incassato", true, undefined);
  return sumExpandedAmountForStato(where, expandMode, null, "Incassato");
}

export type TotalsAlignmentResult = {
  ok: boolean;
  reportAmount: number;
  provvigioniAmount: number;
  diff: number;
};

/** Confronto Report vs Provvigioni: fallisce se i totali divergono. */
export function compareReportProvvigioniAmounts(
  reportAmount: number,
  provvigioniAmount: number,
  epsilon = 0.005,
): TotalsAlignmentResult {
  const diff = Math.round((reportAmount - provvigioniAmount) * 100) / 100;
  const ok = Math.abs(diff) <= epsilon;
  return { ok, reportAmount, provvigioniAmount, diff };
}

/** @deprecated usa compareReportProvvigioniAmounts */
export function compareReportProvvigioniDaIncassare(
  reportAmount: number,
  provvigioniAmount: number,
  epsilon = 0.005,
): TotalsAlignmentResult {
  return compareReportProvvigioniAmounts(
    reportAmount,
    provvigioniAmount,
    epsilon,
  );
}

/**
 * Netto rendiconto atteso quando Report = Incassato|Stornato e stessi filtri
 * della card: Incassato da liquidare − |storni| (storni già con segno −).
 */
export function expectedRendicontoNettoFromIncassatoCard(
  incassatoDaLiquidare: number,
  storniSigned: number,
): number {
  return Math.round((incassatoDaLiquidare + storniSigned) * 100) / 100;
}
