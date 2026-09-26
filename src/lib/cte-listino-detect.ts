import { COMPARA_SEMPLICE_LISTINO, COMPARA_SEMPLICE_PDF_HASH } from "@/lib/cte-compara-listino";
import { allDolomitiListinoOffers, dolomitiOffersForScreenshotHash } from "@/lib/cte-dolomiti-listino";
import { allDufercoFlexCondominiOffers } from "@/lib/cte-duferco-flex-condomini";
import {
  ENEL_CORPORATE_LISTINO,
  ENEL_CORPORATE_SCREENSHOT_HASH,
} from "@/lib/cte-enel-corporate-listino";
import type { CteListinoOffer, KnownCteListino } from "@/lib/cte-listino-shared";
import { isSevIrenListinoText, SEV_IREN_LISTINO } from "@/lib/cte-sev-iren-listino";

export type CteListinoKind =
  | "dolomiti"
  | "enel-corporate"
  | "sev-iren"
  | "compara"
  | "duferco-flex-condomini";

function dolomitiToShared(rows: ReturnType<typeof allDolomitiListinoOffers>): CteListinoOffer[] {
  return rows.map((row) => ({
    supplierName: "Dolomiti",
    offerName: row.offerName,
    utility: row.utility,
    category: row.category,
    commercialSegment: row.commercialSegment,
    priceKind: row.priceKind,
    bands: row.bands,
    spread: row.spread,
    ccvAnnual: row.ccvAnnual,
    ccvMonthly: row.ccvMonthly,
    powerKwMin: null,
    powerKwMax: null,
    annualConsumptionMin: null,
    annualConsumptionMax: null,
    networkLosses: null,
    validFrom: null,
    validTo: row.validTo,
    notes: row.notes,
    warnings: row.warnings,
  }));
}

export function listinoByKind(kind: CteListinoKind): KnownCteListino {
  switch (kind) {
    case "dolomiti":
      return {
        kind: "dolomiti-listino",
        layout: "dolomiti-listino",
        offers: dolomitiToShared(allDolomitiListinoOffers()),
      };
    case "enel-corporate":
      return {
        kind: "enel-corporate-listino",
        layout: "enel-corporate-listino",
        offers: ENEL_CORPORATE_LISTINO,
      };
    case "sev-iren":
      return { kind: "sev-iren-listino", layout: "sev-iren-listino", offers: SEV_IREN_LISTINO };
    case "compara":
      return {
        kind: "compara-semplice",
        layout: "compara-semplice",
        offers: COMPARA_SEMPLICE_LISTINO,
      };
    case "duferco-flex-condomini":
      return {
        kind: "duferco-flex-condomini",
        layout: "duferco-flex-condomini",
        offers: allDufercoFlexCondominiOffers(),
      };
  }
}

export function detectListinoFromImageHash(hex: string): KnownCteListino | null {
  const h = hex.toLowerCase();
  const dolomiti = dolomitiOffersForScreenshotHash(h);
  if (dolomiti?.length) {
    return {
      kind: "dolomiti-listino",
      layout: "dolomiti-listino",
      offers: dolomitiToShared(dolomiti),
    };
  }
  if (h === ENEL_CORPORATE_SCREENSHOT_HASH) {
    return listinoByKind("enel-corporate");
  }
  return null;
}

export function detectListinoFromPdf(hex: string, text: string): KnownCteListino | null {
  if (hex.toLowerCase() === COMPARA_SEMPLICE_PDF_HASH) {
    return listinoByKind("compara");
  }
  if (isSevIrenListinoText(text)) {
    return listinoByKind("sev-iren");
  }
  return null;
}

export const LISTINO_KIND_LABEL: Record<CteListinoKind, string> = {
  dolomiti: "Dolomiti",
  "enel-corporate": "Enel / Soluzione Energia Corporate",
  "sev-iren": "SEV Iren",
  compara: "Compara Semplice",
  "duferco-flex-condomini": "Duferco Flex Condomini",
};
