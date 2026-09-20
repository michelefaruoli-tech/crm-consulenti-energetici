import type { CteCategory, CtePriceKind, CteUtility } from "@/generated/prisma/client";

export type CteSummaryOffer = {
  offerName: string;
  supplierName: string;
  category: CteCategory;
  utility: CteUtility;
  priceKind: CtePriceKind;
  commercialSegment: string | null;
  powerRangeLabel: string;
  consumptionRangeLabel: string;
  priceF1: number | null;
  priceF2: number | null;
  priceF3: number | null;
  spread: number | null;
  ccvLabel: string;
  validityLabel: string;
  networkLossesLabel: string;
};

export type CteSummarySection = {
  category: CteCategory;
  utility: CteUtility;
  priceKind: CtePriceKind;
  title: string;
  rows: CteSummaryOffer[];
};

export type CteSummaryPayload = {
  generatedAt: string;
  sections: CteSummarySection[];
};
