import type { CteListinoOffer } from "@/lib/cte-listino-shared";

const SOURCE =
  "Listino Compara Semplice settembre 2026 (offerta commerciale). Compensi e gettoni non importati.";
const LOSSES =
  "Perdite di rete non indicate: default catalogo (luce incluse, gas N/A).";

function n(extra: string[]): string {
  return [...extra, SOURCE, LOSSES].join(" ");
}

function row(
  partial: Omit<
    CteListinoOffer,
    | "ccvMonthly"
    | "powerKwMin"
    | "powerKwMax"
    | "annualConsumptionMin"
    | "annualConsumptionMax"
    | "validFrom"
    | "networkLosses"
  >,
): CteListinoOffer {
  return {
    ccvMonthly: null,
    powerKwMin: null,
    powerKwMax: null,
    annualConsumptionMin: null,
    annualConsumptionMax: null,
    validFrom: null,
    networkLosses: null,
    ...partial,
  };
}

/**
 * Pagina 1 Compara Semplice luce/gas.
 * Saltati: ENEL BUSINESS SUPER LUCE (già nel listino Corporate F1/F2/F3),
 * telco/TV (pag. 2) e servizi a valore (pag. 3).
 */
export const COMPARA_SEMPLICE_LISTINO: CteListinoOffer[] = [
  row({
    supplierName: "Plenitude",
    offerName: "FIXA TIME 24",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: "COMPARA SEMPLICE",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.163 }],
    spread: null,
    ccvAnnual: 144,
    validTo: "2026-09-30",
    notes: n(["Durata 24 mesi."]),
    warnings: [],
  }),
  row({
    supplierName: "Plenitude",
    offerName: "FIXA TIME 24",
    utility: "GAS",
    category: "RESIDENZIALE",
    commercialSegment: "COMPARA SEMPLICE",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.684 }],
    spread: null,
    ccvAnnual: 144,
    validTo: "2026-09-30",
    notes: n(["Durata 24 mesi."]),
    warnings: [],
  }),
  row({
    supplierName: "Iren",
    offerName: "PRIMA SCELTA",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: "COMPARA SEMPLICE",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.159 }],
    spread: null,
    ccvAnnual: 125,
    validTo: "2026-09-27",
    notes: n([]),
    warnings: ["Durata non indicata nel volantino."],
  }),
  row({
    supplierName: "Iren",
    offerName: "PRIMA SCELTA",
    utility: "GAS",
    category: "RESIDENZIALE",
    commercialSegment: "COMPARA SEMPLICE",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.75 }],
    spread: null,
    ccvAnnual: 120,
    validTo: "2026-09-27",
    notes: n(["Obbligo RID."]),
    warnings: ["Durata non indicata nel volantino."],
  }),
  row({
    supplierName: "Enel",
    offerName: "FIX WEB LUCE",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: "COMPARA SEMPLICE",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.179 }],
    spread: null,
    ccvAnnual: 144,
    validTo: "2026-10-01",
    notes: n([]),
    warnings: ["Durata non indicata nel volantino."],
  }),
  row({
    supplierName: "Enel",
    offerName: "FIX WEB GAS",
    utility: "GAS",
    category: "RESIDENZIALE",
    commercialSegment: "COMPARA SEMPLICE",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.986 }],
    spread: null,
    ccvAnnual: 144,
    validTo: "2026-10-01",
    notes: n(["Obbligo RID."]),
    warnings: ["Durata non indicata nel volantino."],
  }),
  row({
    supplierName: "Acea Energia",
    offerName: "ACEA FIX LUCE",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: "COMPARA SEMPLICE",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.14 }],
    spread: null,
    ccvAnnual: null,
    validTo: "2026-09-30",
    notes: n(["CCV luce non stampata sulla card."]),
    warnings: ["CCV luce non indicata nel volantino."],
  }),
  row({
    supplierName: "Acea Energia",
    offerName: "ACEA FIX GAS",
    utility: "GAS",
    category: "RESIDENZIALE",
    commercialSegment: "COMPARA SEMPLICE",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.64 }],
    spread: null,
    ccvAnnual: 144,
    validTo: "2026-09-30",
    notes: n([]),
    warnings: [],
  }),
  row({
    supplierName: "Engie",
    offerName: "PUNTO FISSO",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: "COMPARA SEMPLICE",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.199 }],
    spread: null,
    ccvAnnual: 120,
    validTo: "2026-09-23",
    notes: n([]),
    warnings: ["Durata non indicata nel volantino."],
  }),
  row({
    supplierName: "Engie",
    offerName: "PUNTO FISSO",
    utility: "GAS",
    category: "RESIDENZIALE",
    commercialSegment: "COMPARA SEMPLICE",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.89 }],
    spread: null,
    ccvAnnual: 120,
    validTo: "2026-09-23",
    notes: n(["Obbligo RID."]),
    warnings: ["Durata non indicata nel volantino."],
  }),
  row({
    supplierName: "Union",
    offerName: "FIX LUCE",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: "COMPARA SEMPLICE",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.164 }],
    spread: null,
    ccvAnnual: 144,
    validTo: "2026-10-07",
    notes: n([]),
    warnings: ["Durata non indicata nel volantino."],
  }),
  row({
    supplierName: "Union",
    offerName: "PUNTO FISSO",
    utility: "GAS",
    category: "RESIDENZIALE",
    commercialSegment: "COMPARA SEMPLICE",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.706 }],
    spread: null,
    ccvAnnual: 144,
    validTo: "2026-10-07",
    notes: n(["Obbligo RID."]),
    warnings: ["Durata non indicata nel volantino."],
  }),
  row({
    supplierName: "Illumia",
    offerName: "ENERGIA LUNGA EASY",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: "COMPARA SEMPLICE",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.145 }],
    spread: null,
    ccvAnnual: 144,
    validTo: "2026-10-10",
    notes: n(["Bonus in fattura al cliente: 70 € al 12° mese."]),
    warnings: [],
  }),
  row({
    supplierName: "Illumia",
    offerName: "ENERGIA LUNGA EASY",
    utility: "GAS",
    category: "RESIDENZIALE",
    commercialSegment: "COMPARA SEMPLICE",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.75 }],
    spread: null,
    ccvAnnual: 144,
    validTo: "2026-10-10",
    notes: n(["Obbligo RID.", "Bonus in fattura al cliente: 70 € al 12° mese."]),
    warnings: [],
  }),
  row({
    supplierName: "Enel",
    offerName: "FIX BUSINESS START GAS",
    utility: "GAS",
    category: "BUSINESS",
    commercialSegment: "COMPARA SEMPLICE",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.87 }],
    spread: null,
    ccvAnnual: 180,
    validTo: "2026-10-01",
    notes: n(["Obbligo RID."]),
    warnings: ["Durata non indicata nel volantino."],
  }),
];

export const COMPARA_SKIPPED = [
  "ENEL BUSINESS SUPER LUCE (Compara MONO 0,20407 / CCV 192): doppione del listino Corporate F1/F2/F3",
  "Pagina telco/TV (fibra, Sky)",
  "Pagina servizi a valore (RCA, Verisure, noleggio, Acqualife, Kena)",
];

/** SHA-256 del PDF Offerta commerciale-9.pdf (settembre 2026). */
export const COMPARA_SEMPLICE_PDF_HASH =
  "a61fff0a5233517009ca6829ba86e8e45719b061e96a0c986a8bde9e971c2818";
