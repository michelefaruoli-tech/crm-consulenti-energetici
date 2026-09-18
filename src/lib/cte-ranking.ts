import type { CteCategory, CteNetworkLosses, CtePriceKind, CteUtility } from "@/generated/prisma/client";
import {
  CTE_DEFAULT_LOSS_RATE,
  CTE_TIME_BAND_WEIGHTS,
  defaultMonthlyConsumption,
} from "@/lib/cte-ranking-defaults";
import type { CteCatalogFilters, CteCatalogTableRow, CteOfferInput } from "@/lib/cte-types";

function dec(v: { toString(): string } | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function effectiveConsumption(
  monthlyC: number,
  utility: CteUtility,
  networkLosses: CteNetworkLosses,
): number {
  if (utility !== "LUCE" || networkLosses !== "EXCLUDED") return monthlyC;
  return monthlyC * (1 + CTE_DEFAULT_LOSS_RATE);
}

function bandPrice(bands: CteOfferInput["priceBands"], timeBand: string): number | null {
  const band = bands.find((b) => b.timeBand === timeBand);
  return band ? band.energyPrice : null;
}

function weightedEnergyPrice(
  bands: CteOfferInput["priceBands"],
  category: CteCategory,
): number | null {
  const mono = bandPrice(bands, "MONO");
  if (mono != null) return mono;

  const weights = CTE_TIME_BAND_WEIGHTS[category];
  const f1 = bandPrice(bands, "F1");
  const f2 = bandPrice(bands, "F2");
  const f3 = bandPrice(bands, "F3");
  const parts: Array<{ w: number; p: number }> = [];
  if (f1 != null) parts.push({ w: weights.F1, p: f1 });
  if (f2 != null) parts.push({ w: weights.F2, p: f2 });
  if (f3 != null) parts.push({ w: weights.F3, p: f3 });
  if (parts.length === 0) return null;

  const weightSum = parts.reduce((s, x) => s + x.w, 0);
  if (weightSum <= 0) return null;
  return parts.reduce((s, x) => s + (x.w / weightSum) * x.p, 0);
}

export function computeMonthlyCost(
  offer: CteOfferInput,
  monthlyConsumption: number,
): number | null {
  const cEff = effectiveConsumption(
    monthlyConsumption,
    offer.utility,
    offer.networkLosses,
  );
  const ccvPart =
    offer.ccvMonthly != null
      ? offer.ccvMonthly
      : offer.ccvAnnual != null
        ? offer.ccvAnnual / 12
        : 0;

  if (offer.priceKind === "VARIABILE") {
    if (offer.spread == null) return null;
    return ccvPart + cEff * offer.spread;
  }

  const energyPrice = weightedEnergyPrice(offer.priceBands, offer.category);
  if (energyPrice == null) return null;
  return cEff * energyPrice + ccvPart;
}

export function isOfferApplicable(
  offer: CteOfferInput,
  monthlyConsumption: number | null,
  powerKw: number | null,
): boolean {
  if (powerKw != null) {
    if (offer.powerKwMin != null && powerKw < offer.powerKwMin) return false;
    if (offer.powerKwMax != null && powerKw > offer.powerKwMax) return false;
  }

  if (monthlyConsumption != null) {
    const annual = monthlyConsumption * 12;
    if (offer.annualConsumptionMin != null && annual < offer.annualConsumptionMin) {
      return false;
    }
    if (offer.annualConsumptionMax != null && annual > offer.annualConsumptionMax) {
      return false;
    }
  }

  return true;
}

function resolveMonthlyConsumption(
  filters: CteCatalogFilters,
  offer: CteOfferInput,
): number | null {
  if (filters.monthlyConsumption != null && filters.monthlyConsumption > 0) {
    return filters.monthlyConsumption;
  }
  if (offer.referenceConsumption != null && offer.referenceConsumption > 0) {
    return offer.referenceConsumption;
  }
  return defaultMonthlyConsumption(filters.category, filters.utility);
}

export function shouldRankCatalog(filters: CteCatalogFilters): boolean {
  if (filters.utility === "GAS" && (filters.monthlyConsumption == null || filters.monthlyConsumption <= 0)) {
    return false;
  }
  return true;
}

export function formatPowerRange(min: number | null, max: number | null): string {
  if (min == null && max == null) return "—";
  if (min != null && max != null) return `DA ${min} A ${max} kW`;
  if (max != null) return `FINO A ${max} kW`;
  return `DA ${min} kW`;
}

export function formatConsumptionRange(
  min: number | null,
  max: number | null,
  utility: CteUtility,
): string {
  const unit = utility === "GAS" ? "Smc" : "kWh";
  if (min == null && max == null) return "—";
  if (min != null && max != null) return `DA ${min} A ${max} ${unit}/anno`;
  if (max != null) return `FINO A ${max} ${unit}/anno`;
  return `DA ${min} ${unit}/anno`;
}

export function formatValidity(validFrom: Date | null, validTo: Date | null): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
  if (validFrom && validTo) return `${fmt(validFrom)} – ${fmt(validTo)}`;
  if (validFrom) return `Dal ${fmt(validFrom)}`;
  if (validTo) return `Fino al ${fmt(validTo)}`;
  return "—";
}

export function networkLossesLabel(value: CteNetworkLosses): string {
  switch (value) {
    case "INCLUDED":
      return "Perdite incluse";
    case "EXCLUDED":
      return "Perdite escluse";
    default:
      return "—";
  }
}

export function formatCcv(ccvAnnual: number | null, ccvMonthly: number | null): string {
  if (ccvAnnual != null) return `${ccvAnnual.toFixed(2)} €/anno`;
  if (ccvMonthly != null) return `${ccvMonthly.toFixed(2)} €/mese`;
  return "—";
}

export function toCatalogTableRow(
  offer: CteOfferInput,
  filters: CteCatalogFilters,
  rank: number | null,
  estimatedMonthlyCost: number | null,
  applicable: boolean,
): CteCatalogTableRow {
  return {
    ...offer,
    rank,
    estimatedMonthlyCost,
    applicable,
    priceMono: bandPrice(offer.priceBands, "MONO"),
    priceF1: bandPrice(offer.priceBands, "F1") ?? bandPrice(offer.priceBands, "MONO"),
    priceF2: bandPrice(offer.priceBands, "F2"),
    priceF3: bandPrice(offer.priceBands, "F3"),
    powerRangeLabel: formatPowerRange(offer.powerKwMin, offer.powerKwMax),
    consumptionRangeLabel: formatConsumptionRange(
      offer.annualConsumptionMin,
      offer.annualConsumptionMax,
      offer.utility,
    ),
    validityLabel: formatValidity(offer.validFrom, offer.validTo),
    networkLossesLabel: networkLossesLabel(offer.networkLosses),
    ccvLabel: formatCcv(offer.ccvAnnual, offer.ccvMonthly),
  };
}

export function rankCteOffers(
  offers: CteOfferInput[],
  filters: CteCatalogFilters,
): CteCatalogTableRow[] {
  const rankingActive = shouldRankCatalog(filters);
  const rows = offers.map((offer) => {
    const monthlyC = rankingActive ? resolveMonthlyConsumption(filters, offer) : null;
    const applicable = isOfferApplicable(offer, monthlyC, filters.powerKw);
    const cost =
      rankingActive && monthlyC != null ? computeMonthlyCost(offer, monthlyC) : null;
    return {
      offer,
      applicable,
      cost,
    };
  });

  if (!rankingActive) {
    const sorted = [...rows].sort((a, b) => {
      const bySupplier = a.offer.supplierName.localeCompare(b.offer.supplierName, "it");
      if (bySupplier !== 0) return bySupplier;
      return a.offer.offerName.localeCompare(b.offer.offerName, "it");
    });
    return sorted.map(({ offer, applicable, cost }) =>
      toCatalogTableRow(offer, filters, null, cost, applicable),
    );
  }

  const applicableRows = rows
    .filter((r) => r.applicable && r.cost != null)
    .sort((a, b) => {
      const costDiff = (a.cost ?? 0) - (b.cost ?? 0);
      if (costDiff !== 0) return costDiff;
      const aValid = a.offer.validTo?.getTime() ?? 0;
      const bValid = b.offer.validTo?.getTime() ?? 0;
      if (bValid !== aValid) return bValid - aValid;
      const byName = a.offer.offerName.localeCompare(b.offer.offerName, "it");
      if (byName !== 0) return byName;
      return a.offer.supplierName.localeCompare(b.offer.supplierName, "it");
    });

  const inapplicableRows = rows
    .filter((r) => !r.applicable || r.cost == null)
    .sort((a, b) => a.offer.offerName.localeCompare(b.offer.offerName, "it"));

  let rank = 1;
  const result: CteCatalogTableRow[] = [];
  for (const { offer, applicable, cost } of applicableRows) {
    result.push(toCatalogTableRow(offer, filters, rank++, cost, applicable));
  }
  for (const { offer, applicable, cost } of inapplicableRows) {
    result.push(toCatalogTableRow(offer, filters, null, cost, applicable));
  }
  return result;
}

/** Helper per deserializzare numeri Prisma Decimal in query layer. */
export function mapDbOffer(
  row: {
    id: string;
    supplierId: string;
    supplier: { name: string };
    utility: CteUtility;
    category: CteCategory;
    commercialSegment: string | null;
    offerName: string;
    priceKind: CtePriceKind;
    powerKwMin: { toString(): string } | null;
    powerKwMax: { toString(): string } | null;
    annualConsumptionMin: { toString(): string } | null;
    annualConsumptionMax: { toString(): string } | null;
    referenceConsumption: { toString(): string } | null;
    networkLosses: CteNetworkLosses;
    ccvAnnual: { toString(): string } | null;
    ccvMonthly: { toString(): string } | null;
    spread: { toString(): string } | null;
    validFrom: Date | null;
    validTo: Date | null;
    active: boolean;
    notes: string | null;
    pdfContentBase64: string | null;
    priceBands: Array<{
      timeBand: string;
      energyPrice: { toString(): string };
      sortOrder: number;
    }>;
  },
): CteOfferInput {
  return {
    id: row.id,
    supplierId: row.supplierId,
    supplierName: row.supplier.name,
    utility: row.utility,
    category: row.category,
    commercialSegment: row.commercialSegment,
    offerName: row.offerName,
    priceKind: row.priceKind,
    powerKwMin: dec(row.powerKwMin),
    powerKwMax: dec(row.powerKwMax),
    annualConsumptionMin: dec(row.annualConsumptionMin),
    annualConsumptionMax: dec(row.annualConsumptionMax),
    referenceConsumption: dec(row.referenceConsumption),
    networkLosses: row.networkLosses,
    ccvAnnual: dec(row.ccvAnnual),
    ccvMonthly: dec(row.ccvMonthly),
    spread: dec(row.spread),
    validFrom: row.validFrom,
    validTo: row.validTo,
    active: row.active,
    notes: row.notes,
    hasPdf: Boolean(row.pdfContentBase64),
    priceBands: row.priceBands
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.timeBand.localeCompare(b.timeBand))
      .map((b) => ({
        timeBand: b.timeBand,
        energyPrice: dec(b.energyPrice) ?? 0,
        sortOrder: b.sortOrder,
      })),
  };
}
