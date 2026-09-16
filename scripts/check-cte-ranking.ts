/**
 * Verifica formule ranking CTE (gas senza consumo, perdite escluse, multi-fascia).
 * Uso: npx tsx scripts/check-cte-ranking.ts
 */
import {
  computeMonthlyCost,
  rankCteOffers,
  shouldRankCatalog,
} from "../src/lib/cte-ranking";
import type { CteOfferInput } from "../src/lib/cte-types";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`❌ ${msg}`);
    process.exit(1);
  }
}

const baseOffer: CteOfferInput = {
  id: "1",
  supplierId: "s1",
  supplierName: "Enel",
  utility: "LUCE",
  category: "BUSINESS",
  commercialSegment: "AC SMALL",
  offerName: "Fix Business",
  priceKind: "FISSO",
  powerKwMin: 3,
  powerKwMax: 25,
  annualConsumptionMin: null,
  annualConsumptionMax: 1_000_000,
  referenceConsumption: null,
  networkLosses: "EXCLUDED",
  ccvAnnual: 120,
  ccvMonthly: null,
  spread: null,
  validFrom: null,
  validTo: new Date("2026-12-31"),
  active: true,
  notes: null,
  hasPdf: false,
  priceBands: [
    { timeBand: "F1", energyPrice: 0.15, sortOrder: 0 },
    { timeBand: "F2", energyPrice: 0.12, sortOrder: 1 },
    { timeBand: "F3", energyPrice: 0.1, sortOrder: 2 },
  ],
};

const monoOffer: CteOfferInput = {
  ...baseOffer,
  id: "2",
  offerName: "Fix WOW",
  networkLosses: "INCLUDED",
  priceBands: [{ timeBand: "MONO", energyPrice: 0.11, sortOrder: 0 }],
};

const gasOffer: CteOfferInput = {
  ...baseOffer,
  id: "3",
  utility: "GAS",
  offerName: "Fix Gas",
  networkLosses: "NOT_APPLICABLE",
  powerKwMin: null,
  powerKwMax: null,
  priceBands: [{ timeBand: "MONO", energyPrice: 0.45, sortOrder: 0 }],
};

// Perdite escluse: costo > stesso prezzo con incluse (consumo fatturato maggiore)
const costExcluded = computeMonthlyCost(baseOffer, 1000)!;
const costIncluded = computeMonthlyCost(
  { ...baseOffer, networkLosses: "INCLUDED" },
  1000,
)!;
assert(costExcluded > costIncluded, "Perdite escluse devono aumentare il costo");

// Gas senza consumo: nessun ranking forzato
assert(
  !shouldRankCatalog({
    category: "RESIDENZIALE",
    utility: "GAS",
    priceKind: "FISSO",
    monthlyConsumption: null,
    powerKw: null,
    validFrom: null,
    validTo: null,
  }),
  "Gas senza consumo non deve attivare ranking",
);

const gasRows = rankCteOffers([gasOffer, { ...gasOffer, id: "4", offerName: "Alpha Gas" }], {
  category: "RESIDENZIALE",
  utility: "GAS",
  priceKind: "FISSO",
  monthlyConsumption: null,
  powerKw: null,
  validFrom: null,
  validTo: null,
});
assert(gasRows.every((r) => r.rank == null), "Gas senza consumo: rank null");

// Luce: ranking attivo e ordine per costo
const ranked = rankCteOffers([baseOffer, monoOffer], {
  category: "BUSINESS",
  utility: "LUCE",
  priceKind: "FISSO",
  monthlyConsumption: 1500,
  powerKw: 10,
  validFrom: null,
  validTo: null,
});
assert(ranked[0]!.rank === 1, "Prima riga rank 1");
assert(
  (ranked[0]!.estimatedMonthlyCost ?? 0) <= (ranked[1]!.estimatedMonthlyCost ?? Infinity),
  "Ordine per costo crescente",
);

console.log("✅ check-cte-ranking: tutti i casi OK");
