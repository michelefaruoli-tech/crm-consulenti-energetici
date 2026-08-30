/**
 * Conteggi badge tab Provvigioni (Tutti / M / R).
 * Stessa logica della lista per ogni scheda, senza filtro stato/focus.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buildProvvigioniListWhere,
  type ProvvigioniFilters,
} from "@/lib/provvigioni-filters";

export type ProvvigioniTabCounts = {
  tutti: number;
  mensile: number;
  annuale: number;
};

const KO_STATUSES = ["KO", "ANNULLATO", "CHIUSO"] as const;

/** Contratto ricorrente ancora in fornitura (non scaduto/chiuso). */
export function activeRecurringContractWhere(
  asOf: Date = new Date(),
): Prisma.ContractWhereInput {
  const today = new Date(asOf);
  today.setHours(23, 59, 59, 999);
  return {
    status: { notIn: [...KO_STATUSES] },
    supplyStartDate: { not: null, lte: today },
    OR: [{ expiryDate: null }, { expiryDate: { gte: today } }],
  };
}

type TabCountsBase = Omit<
  ProvvigioniFilters,
  "stato" | "recurrenceMode" | "competencePeriod"
>;

export async function loadProvvigioniTabCounts(
  base: TabCountsBase,
  /** Mese competenza operativo M (di solito mese scorso, YYYY-MM). */
  reconciliationPeriod: string,
): Promise<ProvvigioniTabCounts> {
  const shared = {
    ...base,
    stato: undefined,
    competencePeriod: undefined,
  };

  const tuttiWhere = buildProvvigioniListWhere({
    filters: { ...shared, recurrenceMode: "all" },
    applyCompetenceToList: false,
  });

  const mensileWhere = buildProvvigioniListWhere({
    filters: { ...shared, recurrenceMode: "monthly" },
    effectiveCompetence: reconciliationPeriod,
    applyCompetenceToList: true,
  });

  const annualeWhere: Prisma.ContractWhereInput = {
    AND: [
      buildProvvigioniListWhere({
        filters: { ...shared, recurrenceMode: "annual" },
        applyCompetenceToList: false,
      }),
      activeRecurringContractWhere(),
    ],
  };

  const [tutti, mensile, annuale] = await Promise.all([
    prisma.contract.count({ where: tuttiWhere }),
    prisma.contract.count({ where: mensileWhere }),
    prisma.contract.count({ where: annualeWhere }),
  ]);

  return { tutti, mensile, annuale };
}
