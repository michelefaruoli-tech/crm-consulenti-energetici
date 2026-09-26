/**
 * Allineamento totali «Da incassare» tra Report e Provvigioni.
 * Provvigioni usa `sumExpandedAmountForStato` senza filtro competenza;
 * il Report deve includere le stesse rate PENDING/MISSING/ERROR_UNPAID
 * (nessun vincolo di mese) + stesso gettone UT.
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

/** Stesso importo della card «Da incassare» in Provvigioni (tutti i periodi). */
export async function sumDaIncassareLikeProvvigioni(
  input: ReportProvvigioniAlignInput,
): Promise<number> {
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
    filters: { ...baseFilters, stato: "Da incassare" },
    applyCompetenceToList: false,
  });

  const supplierIds = input.supplierIds ?? [];
  if (supplierIds.length === 1) {
    where = { AND: [where, { supplierId: supplierIds[0]! }] };
  } else if (supplierIds.length > 1) {
    where = { AND: [where, { supplierId: { in: supplierIds } }] };
  }

  const expandMode = getRecurringExpandMode("Da incassare", true, undefined);
  return sumExpandedAmountForStato(
    where,
    expandMode,
    null,
    "Da incassare",
  );
}

export type TotalsAlignmentResult = {
  ok: boolean;
  reportAmount: number;
  provvigioniAmount: number;
  diff: number;
};

/** Confronto Report vs Provvigioni: fallisce se i totali divergono. */
export function compareReportProvvigioniDaIncassare(
  reportAmount: number,
  provvigioniAmount: number,
  epsilon = 0.005,
): TotalsAlignmentResult {
  const diff = Math.round((reportAmount - provvigioniAmount) * 100) / 100;
  const ok = Math.abs(diff) <= epsilon;
  return { ok, reportAmount, provvigioniAmount, diff };
}
