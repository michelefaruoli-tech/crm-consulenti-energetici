import type { CteCategory, CteUtility } from "@/generated/prisma/client";

/** Consumo mensile di default per ranking quando l'utente non inserisce valori. */
export const CTE_RANKING_DEFAULTS: Record<
  CteCategory,
  Record<CteUtility, number>
> = {
  RESIDENZIALE: { LUCE: 250, GAS: 80 },
  BUSINESS: { LUCE: 1500, GAS: 400 },
  CONDOMINI: { LUCE: 5000, GAS: 2000 },
};

/** Perdite di rete default (10%) quando networkLosses = EXCLUDED. */
export const CTE_DEFAULT_LOSS_RATE = 0.1;

/** Pesi F1/F2/F3 per prezzo medio ponderato (assenza profilo orario cliente). */
export const CTE_TIME_BAND_WEIGHTS: Record<
  CteCategory,
  { F1: number; F2: number; F3: number }
> = {
  RESIDENZIALE: { F1: 0.33, F2: 0.33, F3: 0.34 },
  BUSINESS: { F1: 0.4, F2: 0.25, F3: 0.35 },
  CONDOMINI: { F1: 0.4, F2: 0.25, F3: 0.35 },
};

export function defaultMonthlyConsumption(
  category: CteCategory,
  utility: CteUtility,
): number {
  return CTE_RANKING_DEFAULTS[category][utility];
}

export function consumptionUnitLabel(utility: CteUtility): string {
  return utility === "GAS" ? "Smc" : "kWh";
}
