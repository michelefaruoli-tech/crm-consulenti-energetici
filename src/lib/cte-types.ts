import type {
  CteCategory,
  CteNetworkLosses,
  CtePriceKind,
  CteUtility,
} from "@/generated/prisma/client";

export type CtePriceBandRow = {
  timeBand: string;
  energyPrice: number;
  sortOrder: number;
};

export type CteOfferInput = {
  id: string;
  supplierId: string;
  supplierName: string;
  utility: CteUtility;
  category: CteCategory;
  commercialSegment: string | null;
  offerName: string;
  priceKind: CtePriceKind;
  powerKwMin: number | null;
  powerKwMax: number | null;
  annualConsumptionMin: number | null;
  annualConsumptionMax: number | null;
  referenceConsumption: number | null;
  networkLosses: CteNetworkLosses;
  ccvAnnual: number | null;
  ccvMonthly: number | null;
  spread: number | null;
  validFrom: Date | null;
  validTo: Date | null;
  active: boolean;
  notes: string | null;
  hasPdf: boolean;
  priceBands: CtePriceBandRow[];
};

export type CteCatalogTableRow = CteOfferInput & {
  rank: number | null;
  estimatedMonthlyCost: number | null;
  applicable: boolean;
  priceMono: number | null;
  priceF1: number | null;
  priceF2: number | null;
  priceF3: number | null;
  powerRangeLabel: string;
  consumptionRangeLabel: string;
  validityLabel: string;
  networkLossesLabel: string;
  ccvLabel: string;
};

export type CteCatalogFilters = {
  category: CteCategory;
  utility: CteUtility;
  priceKind: CtePriceKind;
  monthlyConsumption: number | null;
  powerKw: number | null;
  validFrom: string | null;
  validTo: string | null;
};
