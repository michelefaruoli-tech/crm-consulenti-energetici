import type { CtePdfParseResult } from "@/lib/cte-pdf-parse";

export type DolomitiListinoOffer = {
  offerName: string;
  utility: "LUCE" | "GAS";
  category: "RESIDENZIALE" | "BUSINESS";
  commercialSegment: string | null;
  priceKind: "FISSO" | "VARIABILE";
  bands: Array<{ timeBand: "MONO" | "F1" | "F2" | "F3"; energyPrice: number }>;
  spread: number | null;
  ccvAnnual: number | null;
  ccvMonthly: number | null;
  validTo: string | null;
  notes: string;
  warnings: string[];
};

const LOSSES_NOTE =
  "Perdite di rete non indicate nello screenshot: default catalogo (luce incluse, gas N/A).";

function durationNote(months: number, extra: string[] = []): string {
  return [`Durata offerta: ${months} mesi.`, ...extra, LOSSES_NOTE].join(" ");
}

/** Screenshot residenziale + inizio business (hash SHA-256). */
export const DOLOMITI_LISTINO_RESIDENZIALE: DolomitiListinoOffer[] = [
  {
    offerName: "DOLOMITI LUCE GIORNO",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: "cont. 2G",
    priceKind: "FISSO",
    bands: [],
    spread: null,
    ccvAnnual: 96,
    ccvMonthly: 8,
    validTo: "2026-09-23",
    notes: durationNote(36, [
      "Contatore 2G.",
      "Prezzo 10:00-18:00: 0,128 €/kWh; altre ore: 0,183 €/kWh.",
      "Nessun MONO unico: completa le fasce a mano.",
    ]),
    warnings: [
      "Listino: 0,128 €/kWh (10:00-18:00) e 0,183 €/kWh altre ore — non inventato un prezzo MONO.",
    ],
  },
  {
    offerName: "DOLOMITI FISSO LUCE 36",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: null,
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.176 }],
    spread: null,
    ccvAnnual: 72,
    ccvMonthly: 6,
    validTo: "2026-09-23",
    notes: durationNote(36),
    warnings: [],
  },
  {
    offerName: "DOLOMITI FISSO GAS 36",
    utility: "GAS",
    category: "RESIDENZIALE",
    commercialSegment: null,
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.708 }],
    spread: null,
    ccvAnnual: 72,
    ccvMonthly: 6,
    validTo: "2026-09-23",
    notes: durationNote(36),
    warnings: [],
  },
  {
    offerName: "DOLOMITI FLEX 24 LUCE",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: null,
    priceKind: "VARIABILE",
    bands: [],
    spread: 0.01,
    ccvAnnual: 71,
    ccvMonthly: 5.91,
    validTo: "2026-09-23",
    notes: durationNote(24, ["Spread: PUN + 0,01 €/kWh.", "Quota fissa indicata per 12 mesi."]),
    warnings: [],
  },
  {
    offerName: "DOLOMITI FLEX 24 GAS",
    utility: "GAS",
    category: "RESIDENZIALE",
    commercialSegment: null,
    priceKind: "VARIABILE",
    bands: [],
    spread: 0.09,
    ccvAnnual: 66,
    ccvMonthly: 5.5,
    validTo: "2026-09-23",
    notes: durationNote(24, ["Spread: PSV + 0,09 €/Smc.", "Quota fissa indicata per 12 mesi."]),
    warnings: [],
  },
  {
    offerName: "DOLOMITI FLEX LUCE EXTRA",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: "EXTRA",
    priceKind: "VARIABILE",
    bands: [],
    spread: 0.01,
    ccvAnnual: 136,
    ccvMonthly: 11.33,
    validTo: "2026-09-23",
    notes: durationNote(12, ["Spread: PUN + 0,01 €/kWh."]),
    warnings: [],
  },
  {
    offerName: "DOLOMITI LUCE GIORNO EXTRA",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: "EXTRA",
    priceKind: "FISSO",
    bands: [],
    spread: null,
    ccvAnnual: 136,
    ccvMonthly: 11.33,
    validTo: "2026-09-23",
    notes: durationNote(12, [
      "Prezzo 10:00-18:00: 0,128 €/kWh; altre ore: 0,183 €/kWh.",
      "Nessun MONO unico: completa le fasce a mano.",
    ]),
    warnings: [
      "Listino: 0,128 €/kWh (10:00-18:00) e 0,183 €/kWh altre ore — non inventato un prezzo MONO.",
    ],
  },
  {
    offerName: "DOLOMITI FISSO LUCE 36 EXTRA",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: "EXTRA",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.176 }],
    spread: null,
    ccvAnnual: 112,
    ccvMonthly: 9.33,
    validTo: "2026-09-23",
    notes: durationNote(36),
    warnings: [],
  },
  {
    offerName: "DOLOMITI FISSO GAS 36 EXTRA",
    utility: "GAS",
    category: "RESIDENZIALE",
    commercialSegment: "EXTRA",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.708 }],
    spread: null,
    ccvAnnual: 112,
    ccvMonthly: 9.33,
    validTo: "2026-09-23",
    notes: durationNote(36),
    warnings: [],
  },
];

/** Screenshot business / corporate / pertinenza. */
export const DOLOMITI_LISTINO_BUSINESS: DolomitiListinoOffer[] = [
  {
    offerName: "DOLOMITI FISSO GAS 12 BUS",
    utility: "GAS",
    category: "BUSINESS",
    commercialSegment: "BUSINESS",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.958 }],
    spread: null,
    ccvAnnual: 180,
    ccvMonthly: 15,
    validTo: "2026-09-23",
    notes: durationNote(12),
    warnings: [],
  },
  {
    offerName: "DOLOMITI FISSO LUCE 36 CORPORATE",
    utility: "LUCE",
    category: "BUSINESS",
    commercialSegment: "CORPORATE",
    priceKind: "FISSO",
    bands: [
      { timeBand: "F1", energyPrice: 0.181 },
      { timeBand: "F2", energyPrice: 0.194 },
      { timeBand: "F3", energyPrice: 0.167 },
    ],
    spread: null,
    ccvAnnual: 150,
    ccvMonthly: 12.5,
    validTo: "2026-09-23",
    notes: durationNote(36, ["Obbligo RID.", "Penale sulla durata."]),
    warnings: [],
  },
  {
    offerName: "DOLOMITI FISSO GAS 12 CORPORATE",
    utility: "GAS",
    category: "BUSINESS",
    commercialSegment: "CORPORATE",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.928 }],
    spread: null,
    ccvAnnual: 150,
    ccvMonthly: 12.5,
    validTo: "2026-09-23",
    notes: durationNote(12, ["Obbligo RID."]),
    warnings: [],
  },
  {
    offerName: "DOLOMITI FISSO GAS 12 BUSINESS EXTRA",
    utility: "GAS",
    category: "BUSINESS",
    commercialSegment: "EXTRA",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 1.008 }],
    spread: null,
    ccvAnnual: 190,
    ccvMonthly: 15.83,
    validTo: "2026-09-23",
    notes: durationNote(12),
    warnings: [],
  },
  {
    offerName: "DOLOMITI ORARIA LUCE CORPORATE",
    utility: "LUCE",
    category: "BUSINESS",
    commercialSegment: "CORPORATE",
    priceKind: "VARIABILE",
    bands: [],
    spread: 0.015,
    ccvAnnual: 150,
    ccvMonthly: 12.5,
    validTo: "2027-01-26",
    notes: durationNote(24, ["Spread: PUN + 0,015 €/kWh.", "Obbligo RID."]),
    warnings: [],
  },
  {
    offerName: "DOLOMITI FLEX GAS CORPORATE",
    utility: "GAS",
    category: "BUSINESS",
    commercialSegment: "CORPORATE",
    priceKind: "VARIABILE",
    bands: [],
    spread: 0.085,
    ccvAnnual: 150,
    ccvMonthly: 12.5,
    validTo: "2027-01-26",
    notes: durationNote(24, ["Spread: PSV + 0,085 €/Smc.", "Obbligo RID."]),
    warnings: [],
  },
  {
    offerName: "DOLOMITI ORARIA PERTINENZA",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: "PERTINENZA / ALTRI USI",
    priceKind: "VARIABILE",
    bands: [],
    spread: 0.065,
    ccvAnnual: 84,
    ccvMonthly: 7,
    validTo: "2027-01-26",
    notes: durationNote(24, ["Spread: PUN + 0,065 €/kWh.", "Listino altri usi per CF."]),
    warnings: [],
  },
];

/** SHA-256 dei due screenshot caricati (settembre 2026). */
export const DOLOMITI_SCREENSHOT_HASHES: Record<string, "residenziale" | "business"> = {
  c20e736bb743e2249dd153bfec386ac7980a30ea58ad42d4392d6016b98d949b: "residenziale",
  b1af7e5c38ec84459a95752fbde153aa580bb5feaa1e20cc7a1591798728ebe5: "business",
};

export function dolomitiOffersForScreenshotHash(hex: string): DolomitiListinoOffer[] | null {
  const sheet = DOLOMITI_SCREENSHOT_HASHES[hex.toLowerCase()];
  if (sheet === "residenziale") return DOLOMITI_LISTINO_RESIDENZIALE;
  if (sheet === "business") return DOLOMITI_LISTINO_BUSINESS;
  return null;
}

export function allDolomitiListinoOffers(): DolomitiListinoOffer[] {
  return [...DOLOMITI_LISTINO_RESIDENZIALE, ...DOLOMITI_LISTINO_BUSINESS];
}

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

export function dolomitiOfferToParseResult(row: DolomitiListinoOffer): CtePdfParseResult {
  const networkLosses = row.utility === "GAS" ? "NOT_APPLICABLE" : "INCLUDED";
  const filled: Record<string, boolean> = {
    supplierName: true,
    offerName: true,
    utility: true,
    category: true,
    commercialSegment: Boolean(row.commercialSegment),
    priceKind: true,
    powerKwMin: false,
    powerKwMax: false,
    annualConsumptionMin: false,
    annualConsumptionMax: false,
    networkLosses: true,
    ccvAnnual: row.ccvAnnual != null,
    validFrom: false,
    validTo: Boolean(row.validTo),
    bands: row.bands.length > 0 || row.spread != null,
  };
  const hits: CtePdfParseResult["hits"] = [
    { field: "supplierName", label: "Fornitore", value: "Dolomiti", snippet: "listino Dolomiti" },
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
    layout: "dolomiti-listino",
    supplierName: "Dolomiti",
    offerName: row.offerName,
    utility: row.utility,
    category: row.category,
    commercialSegment: row.commercialSegment,
    priceKind: row.priceKind,
    powerKwMin: null,
    powerKwMax: null,
    annualConsumptionMin: null,
    annualConsumptionMax: null,
    networkLosses,
    ccvAnnual: row.ccvAnnual,
    ccvMonthly: row.ccvMonthly,
    spread: row.spread,
    validFrom: null,
    validTo: row.validTo,
    bands: row.bands,
    suggestedNotes: row.notes,
    warnings: [
      ...row.warnings,
      "Potenza e consumi min/max non indicati nello screenshot.",
    ],
    hits,
    filledFieldLabels: EMPTY_TRACK.filter((k) => filled[k]).map((k) => FIELD_LABELS[k] ?? k),
    emptyFieldLabels: EMPTY_TRACK.filter((k) => !filled[k]).map((k) => FIELD_LABELS[k] ?? k),
    textChars: row.notes.length,
  };
}
