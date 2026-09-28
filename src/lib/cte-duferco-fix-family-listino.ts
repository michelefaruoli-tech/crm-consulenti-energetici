import type { CteListinoOffer } from "@/lib/cte-listino-shared";

/**
 * Duferco Fix Family residenziali — CTE settembre 2026 (PDF FIX_FAMILY_*_24_MESI).
 * Domestici, consumi fino a 5.000 kWh, prezzo fisso 24 mesi poi PUN Index + 0.
 * Distinct da Flex Condomini (listino separato).
 */
const SOURCE =
  "Fonte PDF Duferco Fix Family 24 mesi (validità CTE settembre 2026). QCV usata come CCV catalogo. Prezzi al lordo delle perdite di rete.";

function offer(opts: {
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
      SOURCE,
    ].join(" "),
    warnings: [
      "Peak/Off Peak solo in nota: in catalogo applicato MONO (POD non orari → Mono obbligatorio).",
    ],
  };
}

export const DUFERCO_FIX_FAMILY_LISTINO: CteListinoOffer[] = [
  offer({
    offerName: "FIX FAMILY SEMPRE ZERO XS 24 MESI",
    mono: 0.14531,
    peak: 0.15301,
    offPeak: 0.14102,
    ccvAnnual: 133.23,
    codiceMono: "003450ESFML02XX00000010073770926",
  }),
  offer({
    offerName: "FIX FAMILY SEMPRE ZERO S 24 MESI",
    mono: 0.14201,
    peak: 0.14971,
    offPeak: 0.13772,
    ccvAnnual: 157.23,
    codiceMono: "003450ESFML02XX00000010073660926",
  }),
  offer({
    offerName: "FIX FAMILY SEMPRE ZERO M 24 MESI",
    mono: 0.13871,
    peak: 0.14641,
    offPeak: 0.13442,
    ccvAnnual: 193.23,
    codiceMono: "003450ESFML02XX00000010073740926",
  }),
  offer({
    offerName: "FIX FAMILY CUN 1 24 MESI",
    mono: 0.12991,
    peak: 0.13761,
    offPeak: 0.12562,
    ccvAnnual: 157.23,
    codiceMono: "003450ESFML01XX00000010073630926",
  }),
  offer({
    offerName: "FIX FAMILY CUN 2 24 MESI",
    mono: 0.12441,
    peak: 0.13211,
    offPeak: 0.12012,
    ccvAnnual: 193.23,
    codiceMono: "003450ESFML01XX00000010073670926",
  }),
];

export function isDufercoFixFamilyListinoText(text: string): boolean {
  const t = text.replace(/\s+/g, " ");
  return (
    /FIX\s*FAMILY/i.test(t) &&
    /DUFERCO\s*ENERGIA/i.test(t) &&
    /SEMPRE\s*ZERO|CUN\s*[12]/i.test(t) &&
    /CLIENTI\s*DOMESTICI/i.test(t)
  );
}

export function allDufercoFixFamilyOffers(): CteListinoOffer[] {
  return DUFERCO_FIX_FAMILY_LISTINO;
}
