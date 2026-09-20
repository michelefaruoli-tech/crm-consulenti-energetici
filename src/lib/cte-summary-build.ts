import type { CteCategory, CtePriceKind, CteUtility } from "@/generated/prisma/client";
import {
  formatConsumptionRange,
  formatCcv,
  formatPowerRange,
  formatValidity,
  networkLossesLabel,
  rankCteOffers,
} from "@/lib/cte-ranking";
import type { CteOfferInput } from "@/lib/cte-types";
import type { CteSummaryPayload, CteSummarySection } from "@/lib/cte-summary-types";

export const CTE_SUMMARY_GROUPS: Array<{
  category: CteCategory;
  utility: CteUtility;
  priceKind: CtePriceKind;
  title: string;
}> = [
  { category: "RESIDENZIALE", utility: "LUCE", priceKind: "FISSO", title: "RESIDENZIALE · LUCE FISSA" },
  { category: "RESIDENZIALE", utility: "LUCE", priceKind: "VARIABILE", title: "RESIDENZIALE · LUCE VARIABILE" },
  { category: "RESIDENZIALE", utility: "GAS", priceKind: "FISSO", title: "RESIDENZIALE · GAS FISSO" },
  { category: "RESIDENZIALE", utility: "GAS", priceKind: "VARIABILE", title: "RESIDENZIALE · GAS VARIABILE" },
  { category: "BUSINESS", utility: "LUCE", priceKind: "FISSO", title: "BUSINESS · LUCE FISSA" },
  { category: "BUSINESS", utility: "LUCE", priceKind: "VARIABILE", title: "BUSINESS · LUCE VARIABILE" },
  { category: "BUSINESS", utility: "GAS", priceKind: "FISSO", title: "BUSINESS · GAS FISSO" },
  { category: "BUSINESS", utility: "GAS", priceKind: "VARIABILE", title: "BUSINESS · GAS VARIABILE" },
  { category: "CONDOMINI", utility: "LUCE", priceKind: "FISSO", title: "CONDOMINI · LUCE FISSA" },
  { category: "CONDOMINI", utility: "LUCE", priceKind: "VARIABILE", title: "CONDOMINI · LUCE VARIABILE" },
  { category: "CONDOMINI", utility: "GAS", priceKind: "FISSO", title: "CONDOMINI · GAS FISSO" },
  { category: "CONDOMINI", utility: "GAS", priceKind: "VARIABILE", title: "CONDOMINI · GAS VARIABILE" },
];

export function buildCteSummaryPayload(
  offers: CteOfferInput[],
  generatedAt = new Date(),
): CteSummaryPayload {
  const sections: CteSummarySection[] = [];
  for (const group of CTE_SUMMARY_GROUPS) {
    const slice = offers.filter(
      (o) =>
        o.category === group.category &&
        o.utility === group.utility &&
        o.priceKind === group.priceKind,
    );
    if (slice.length === 0) continue;
    const ranked = rankCteOffers(slice, {
      category: group.category,
      utility: group.utility,
      priceKind: group.priceKind,
      monthlyConsumption: null,
      powerKw: null,
      validFrom: null,
      validTo: null,
    });
    sections.push({
      category: group.category,
      utility: group.utility,
      priceKind: group.priceKind,
      title: group.title,
      rows: ranked.map((r) => ({
        offerName: r.offerName,
        supplierName: r.supplierName,
        category: r.category,
        utility: r.utility,
        priceKind: r.priceKind,
        commercialSegment: r.commercialSegment,
        powerRangeLabel: formatPowerRange(r.powerKwMin, r.powerKwMax),
        consumptionRangeLabel: formatConsumptionRange(
          r.annualConsumptionMin,
          r.annualConsumptionMax,
          r.utility,
        ),
        priceF1: r.priceF1,
        priceF2: r.priceF2,
        priceF3: r.priceF3,
        spread: r.spread,
        ccvLabel: formatCcv(r.ccvAnnual, r.ccvMonthly),
        validityLabel: formatValidity(r.validFrom, r.validTo),
        networkLossesLabel: networkLossesLabel(r.networkLosses),
      })),
    });
  }
  return { generatedAt: generatedAt.toISOString(), sections };
}
