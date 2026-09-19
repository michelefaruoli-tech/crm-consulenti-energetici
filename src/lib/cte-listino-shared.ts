import type { PrismaClient } from "@/generated/prisma/client";
import type { CtePdfParseResult } from "@/lib/cte-pdf-parse";
import { matchSupplierId } from "@/lib/cte-pdf-parse";

export type CteListinoOffer = {
  supplierName: string;
  offerName: string;
  utility: "LUCE" | "GAS";
  category: "RESIDENZIALE" | "BUSINESS" | "CONDOMINI";
  commercialSegment: string | null;
  priceKind: "FISSO" | "VARIABILE";
  bands: Array<{ timeBand: "MONO" | "F1" | "F2" | "F3"; energyPrice: number }>;
  spread: number | null;
  ccvAnnual: number | null;
  ccvMonthly: number | null;
  powerKwMin: number | null;
  powerKwMax: number | null;
  annualConsumptionMin: number | null;
  annualConsumptionMax: number | null;
  networkLosses: "INCLUDED" | "EXCLUDED" | "NOT_APPLICABLE" | null;
  validFrom: string | null;
  validTo: string | null;
  notes: string;
  warnings: string[];
};

export type KnownCteListino = {
  kind: string;
  layout: CtePdfParseResult["layout"];
  offers: CteListinoOffer[];
};

const FIELD_LABELS: Record<string, string> = {
  supplierName: "Fornitore",
  offerName: "Nome CTE",
  utility: "Commodity",
  category: "Segmento",
  commercialSegment: "Segmento commerciale",
  priceKind: "Tipologia prezzo",
  powerKwMin: "Potenza min",
  powerKwMax: "Potenza max",
  annualConsumptionMin: "Consumo annuo min",
  annualConsumptionMax: "Consumo annuo max",
  networkLosses: "Perdite di rete",
  ccvAnnual: "CCV / quota fissa",
  validFrom: "Validità dal",
  validTo: "Validità al",
  bands: "Fasce prezzo",
};

const EMPTY_TRACK = [
  "supplierName",
  "offerName",
  "utility",
  "category",
  "commercialSegment",
  "priceKind",
  "powerKwMin",
  "powerKwMax",
  "annualConsumptionMin",
  "annualConsumptionMax",
  "networkLosses",
  "ccvAnnual",
  "validFrom",
  "validTo",
  "bands",
] as const;

function defaultLosses(row: CteListinoOffer): "INCLUDED" | "EXCLUDED" | "NOT_APPLICABLE" {
  if (row.networkLosses) return row.networkLosses;
  return row.utility === "GAS" ? "NOT_APPLICABLE" : "INCLUDED";
}

export function listinoOfferToParseResult(
  row: CteListinoOffer,
  layout: CtePdfParseResult["layout"],
): CtePdfParseResult {
  const networkLosses = defaultLosses(row);
  const filled: Record<string, boolean> = {
    supplierName: true,
    offerName: true,
    utility: true,
    category: true,
    commercialSegment: Boolean(row.commercialSegment),
    priceKind: true,
    powerKwMin: row.powerKwMin != null,
    powerKwMax: row.powerKwMax != null,
    annualConsumptionMin: row.annualConsumptionMin != null,
    annualConsumptionMax: row.annualConsumptionMax != null,
    networkLosses: true,
    ccvAnnual: row.ccvAnnual != null,
    validFrom: Boolean(row.validFrom),
    validTo: Boolean(row.validTo),
    bands: row.bands.length > 0 || row.spread != null,
  };
  const hits: CtePdfParseResult["hits"] = [
    { field: "supplierName", label: "Fornitore", value: row.supplierName, snippet: row.offerName },
    { field: "offerName", label: "Nome CTE", value: row.offerName, snippet: row.offerName },
  ];
  if (row.bands.length) {
    hits.push({
      field: "bands",
      label: "Fasce prezzo",
      value: row.bands.map((b) => `${b.timeBand} ${b.energyPrice}`).join(" / "),
      snippet: row.offerName,
    });
  }
  if (row.spread != null) {
    hits.push({
      field: "bands",
      label: "Fasce prezzo",
      value: `spread ${row.spread}`,
      snippet: row.offerName,
    });
  }
  if (row.ccvAnnual != null) {
    hits.push({
      field: "ccvAnnual",
      label: "CCV / quota fissa",
      value: String(row.ccvAnnual),
      snippet: row.offerName,
    });
  }
  return {
    layout,
    supplierName: row.supplierName,
    offerName: row.offerName,
    utility: row.utility,
    category: row.category,
    commercialSegment: row.commercialSegment,
    priceKind: row.priceKind,
    powerKwMin: row.powerKwMin,
    powerKwMax: row.powerKwMax,
    annualConsumptionMin: row.annualConsumptionMin,
    annualConsumptionMax: row.annualConsumptionMax,
    networkLosses,
    ccvAnnual: row.ccvAnnual,
    ccvMonthly: row.ccvMonthly,
    spread: row.spread,
    validFrom: row.validFrom,
    validTo: row.validTo,
    bands: row.bands,
    suggestedNotes: row.notes,
    warnings: row.warnings,
    hits,
    filledFieldLabels: EMPTY_TRACK.filter((k) => filled[k]).map((k) => FIELD_LABELS[k] ?? k),
    emptyFieldLabels: EMPTY_TRACK.filter((k) => !filled[k]).map((k) => FIELD_LABELS[k] ?? k),
    textChars: row.notes.length,
  };
}

export async function upsertListinoOffers(
  prisma: PrismaClient,
  suppliers: Array<{ id: string; name: string; code?: string | null }>,
  rows: CteListinoOffer[],
): Promise<{ created: number; updated: number; skipped: string[] }> {
  let created = 0;
  let updated = 0;
  const skipped: string[] = [];

  for (const row of rows) {
    const match = matchSupplierId(row.supplierName, suppliers);
    if (!match.supplierId) {
      skipped.push(`${row.offerName} (fornitore ${row.supplierName} assente)`);
      continue;
    }
    const existing = await prisma.cteOffer.findFirst({
      where: {
        supplierId: match.supplierId,
        offerName: row.offerName,
        utility: row.utility,
        category: row.category,
      },
      select: { id: true },
    });
    const data = {
      supplierId: match.supplierId,
      utility: row.utility,
      category: row.category,
      commercialSegment: row.commercialSegment,
      offerName: row.offerName,
      priceKind: row.priceKind,
      powerKwMin: row.powerKwMin,
      powerKwMax: row.powerKwMax,
      annualConsumptionMin: row.annualConsumptionMin,
      annualConsumptionMax: row.annualConsumptionMax,
      networkLosses: defaultLosses(row),
      ccvAnnual: row.ccvAnnual,
      ccvMonthly: row.ccvMonthly,
      spread: row.spread,
      validFrom: row.validFrom ? new Date(`${row.validFrom}T00:00:00.000Z`) : null,
      validTo: row.validTo ? new Date(`${row.validTo}T00:00:00.000Z`) : null,
      notes: row.notes,
      extractionStatus: "confirmed",
      active: true,
    };
    let offerId: string;
    if (existing) {
      await prisma.cteOffer.update({ where: { id: existing.id }, data });
      offerId = existing.id;
      updated += 1;
    } else {
      const createdRow = await prisma.cteOffer.create({ data });
      offerId = createdRow.id;
      created += 1;
    }
    const oldBands = await prisma.ctePriceBand.findMany({
      where: { cteOfferId: offerId },
      select: { id: true },
    });
    for (const band of oldBands) {
      await prisma.ctePriceBand.delete({ where: { id: band.id } });
    }
    for (let i = 0; i < row.bands.length; i++) {
      const band = row.bands[i]!;
      await prisma.ctePriceBand.create({
        data: {
          cteOfferId: offerId,
          timeBand: band.timeBand,
          energyPrice: band.energyPrice,
          sortOrder: i,
        },
      });
    }
  }

  return { created, updated, skipped };
}
