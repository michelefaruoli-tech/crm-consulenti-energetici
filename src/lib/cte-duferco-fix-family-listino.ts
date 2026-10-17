import type { CteListinoOffer } from "@/lib/cte-listino-shared";

/**
 * Duferco Fix Family residenziali — luce (settembre 2026) + gas (ottobre 2026).
 * Luce: PDF FIX_FAMILY_*_24_MESI (kWh). Gas: CUN 4 / Sempre Zero XS (Smc).
 * Distinct da Flex Condomini (listino separato).
 */
const SOURCE_LUCE =
  "Fonte PDF Duferco Fix Family 24 mesi (validità CTE settembre 2026). QCV usata come CCV catalogo. Prezzi al lordo delle perdite di rete.";

const SOURCE_GAS =
  "Fonte PDF Duferco Fix Family gas 24 mesi (validità CTE ottobre 2026, adesione 15–31/10/2026). CVD / componente vendita usata come CCV catalogo.";

/** PDF gas in `public/cte/duferco-fix-family/` (deployati con l’app). */
export const DUFERCO_FIX_FAMILY_GAS_PDF_FILES = [
  {
    offerName: "FIX FAMILY CUN 4 24 MESI",
    utility: "GAS" as const,
    filename: "FIX_FAMILY_CUN_4_24_MESI.pdf",
  },
  {
    offerName: "FIX FAMILY SEMPRE ZERO XS 24 MESI",
    utility: "GAS" as const,
    filename: "FIX_FAMILY_SEMPRE_ZERO_XS_24_MESI.pdf",
  },
] as const;

function luceOffer(opts: {
  offerName: string;
  mono: number;
  peak: number;
  offPeak: number;
  ccvAnnual: number;
  codiceMono: string;
}): CteListinoOffer {
  return {
    supplierName: "Duferco Energia",
    offerName: opts.offerName,
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: null,
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: opts.mono }],
    spread: null,
    ccvAnnual: opts.ccvAnnual,
    ccvMonthly: null,
    powerKwMin: null,
    powerKwMax: null,
    annualConsumptionMin: null,
    annualConsumptionMax: 5000,
    networkLosses: "INCLUDED",
    validFrom: "2026-09-01",
    validTo: "2026-09-30",
    notes: [
      "Durata condizioni economiche: 24 mesi; dal 25° mese PUN Index GME orario + 0,00000 €/kWh.",
      `Prezzo MONO ${String(opts.mono).replace(".", ",")} €/kWh (F1=F2=F3).`,
      `Peak ${String(opts.peak).replace(".", ",")} / Off Peak ${String(opts.offPeak).replace(".", ",")} €/kWh (solo POD orari; altrimenti Mono).`,
      `Codice offerta Mono: ${opts.codiceMono}.`,
      "Clienti domestici con consumi fino a 5.000 kWh.",
      SOURCE_LUCE,
    ].join(" "),
    warnings: [
      "Peak/Off Peak solo in nota: in catalogo applicato MONO (POD non orari → Mono obbligatorio).",
    ],
  };
}

function gasOffer(opts: {
  offerName: string;
  price: number;
  codice: string;
}): CteListinoOffer {
  return {
    supplierName: "Duferco Energia",
    offerName: opts.offerName,
    utility: "GAS",
    category: "RESIDENZIALE",
    commercialSegment: null,
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: opts.price }],
    spread: null,
    ccvAnnual: 156,
    ccvMonthly: null,
    powerKwMin: null,
    powerKwMax: null,
    annualConsumptionMin: null,
    annualConsumptionMax: 1500,
    networkLosses: "NOT_APPLICABLE",
    validFrom: "2026-10-15",
    validTo: "2026-10-31",
    notes: [
      "Durata condizioni economiche: 24 mesi; dal 25° mese PSV Day Ahead + 0,00000 €/Smc.",
      `Prezzo gas ${String(opts.price).replace(".", ",")} €/Smc (primi 24 mesi).`,
      `Codice offerta: ${opts.codice}.`,
      "Clienti domestici con consumi fino a 1.500 Smc.",
      SOURCE_GAS,
    ].join(" "),
    warnings: [],
  };
}

/** 5 luce (invariate) + 2 gas ottobre 2026. */
export const DUFERCO_FIX_FAMILY_LISTINO: CteListinoOffer[] = [
  luceOffer({
    offerName: "FIX FAMILY SEMPRE ZERO XS 24 MESI",
    mono: 0.14531,
    peak: 0.15301,
    offPeak: 0.14102,
    ccvAnnual: 133.23,
    codiceMono: "003450ESFML02XX00000010073770926",
  }),
  luceOffer({
    offerName: "FIX FAMILY SEMPRE ZERO S 24 MESI",
    mono: 0.14201,
    peak: 0.14971,
    offPeak: 0.13772,
    ccvAnnual: 157.23,
    codiceMono: "003450ESFML02XX00000010073660926",
  }),
  luceOffer({
    offerName: "FIX FAMILY SEMPRE ZERO M 24 MESI",
    mono: 0.13871,
    peak: 0.14641,
    offPeak: 0.13442,
    ccvAnnual: 193.23,
    codiceMono: "003450ESFML02XX00000010073740926",
  }),
  luceOffer({
    offerName: "FIX FAMILY CUN 1 24 MESI",
    mono: 0.12991,
    peak: 0.13761,
    offPeak: 0.12562,
    ccvAnnual: 157.23,
    codiceMono: "003450ESFML01XX00000010073630926",
  }),
  luceOffer({
    offerName: "FIX FAMILY CUN 2 24 MESI",
    mono: 0.12441,
    peak: 0.13211,
    offPeak: 0.12012,
    ccvAnnual: 193.23,
    codiceMono: "003450ESFML01XX00000010073670926",
  }),
  gasOffer({
    offerName: "FIX FAMILY CUN 4 24 MESI",
    price: 0.745,
    codice: "003450GSFML05XX00000010073831026",
  }),
  gasOffer({
    offerName: "FIX FAMILY SEMPRE ZERO XS 24 MESI",
    price: 0.739,
    codice: "003450GSFML05XX00000010073861026",
  }),
];

export function isDufercoFixFamilyListinoText(text: string): boolean {
  const t = text.replace(/\s+/g, " ");
  const family = /FIX\s*FAMILY/i.test(t) && /DUFERCO\s*ENERGIA/i.test(t);
  if (!family) return false;
  const luceShape =
    /SEMPRE\s*ZERO|CUN\s*[12]/i.test(t) && /CLIENTI\s*DOMESTICI/i.test(t) && /kWh/i.test(t);
  const gasShape =
    (/SEMPRE\s*ZERO|CUN\s*4/i.test(t) || /GSFML/i.test(t)) &&
    /GAS\s*NATURALE|1\.500\s*smc/i.test(t);
  return luceShape || gasShape;
}

export function allDufercoFixFamilyOffers(): CteListinoOffer[] {
  return DUFERCO_FIX_FAMILY_LISTINO;
}
