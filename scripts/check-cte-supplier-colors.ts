/**
 * Colori fornitore CTE e ranking per quota energia.
 * Uso: npx tsx scripts/check-cte-supplier-colors.ts
 */
import { energyQuota } from "../src/lib/cte-ranking";
import { buildCteSummaryPayload } from "../src/lib/cte-summary-build";
import { cteSupplierColorId, cteSupplierPalette } from "../src/lib/cte-supplier-colors";
import type { CteOfferInput } from "../src/lib/cte-types";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(cteSupplierColorId("Dolomiti Energia") === "dolomiti", "dolomiti");
assert(cteSupplierColorId("Duferco Energia") === "duferco", "duferco");
assert(cteSupplierColorId("Enel Energia") === "enel", "enel");
assert(cteSupplierColorId("SEV Iren") === "iren", "iren");
assert(cteSupplierColorId("Acea Energia") === "acea", "acea");
assert(cteSupplierColorId("Eni Plenitude") === "plenitude", "plenitude");
assert(cteSupplierColorId("Engie") === "engie", "engie");
assert(cteSupplierColorId("Union") === "other", "other");

assert(cteSupplierPalette("Enel").accent === "#E6007E", "enel viola");
assert(cteSupplierPalette("Dolomiti").fill.startsWith("#"), "dolomiti hex");
assert(cteSupplierPalette("Iren").accent === "#C2410C", "iren arancio scuro");

const variabile: CteOfferInput = {
  id: "v",
  supplierId: "s",
  supplierName: "Iren",
  utility: "LUCE",
  category: "RESIDENZIALE",
  commercialSegment: null,
  offerName: "Flex",
  priceKind: "VARIABILE",
  powerKwMin: null,
  powerKwMax: null,
  annualConsumptionMin: null,
  annualConsumptionMax: null,
  referenceConsumption: null,
  networkLosses: "INCLUDED",
  ccvAnnual: 100,
  ccvMonthly: null,
  spread: 0.01,
  validFrom: null,
  validTo: null,
  active: true,
  notes: null,
  hasPdf: false,
  priceBands: [],
};
assert(energyQuota(variabile) === 0.01, "variabile = spread");

const cara: CteOfferInput = {
  ...variabile,
  id: "f",
  offerName: "Cara",
  priceKind: "FISSO",
  spread: null,
  priceBands: [{ timeBand: "MONO", energyPrice: 0.2, sortOrder: 0 }],
};
const economica: CteOfferInput = {
  ...cara,
  id: "e",
  offerName: "Economica",
  supplierName: "Enel",
  priceBands: [{ timeBand: "MONO", energyPrice: 0.11, sortOrder: 0 }],
};
const summary = buildCteSummaryPayload([variabile, cara, economica]);
assert(summary.sections.length === 2, "due sezioni (fissa + variabile)");
const fissa = summary.sections.find((s) => s.title === "RESIDENZIALE · LUCE FISSA");
assert(fissa?.rows[0]?.offerName === "Economica", "riepilogo: quota più bassa prima");
assert(fissa?.rows[0]?.supplierName === "Enel", "enel in testa");

console.log("check-cte-supplier-colors: ok");
