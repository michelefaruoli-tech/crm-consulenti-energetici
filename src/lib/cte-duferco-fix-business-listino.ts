import type { CteListinoOffer } from "@/lib/cte-listino-shared";

/**
 * Duferco Fix Business — luce fissa business (ottobre 2026).
 * PDF in `public/cte/duferco-fix-business/`. Distinct da Fix Family (residenziale).
 */
const SOURCE =
  "Fonte PDF Duferco Fix Business 24 mesi (validità CTE ottobre 2026). QCV usata come CCV catalogo. Prezzi al lordo delle perdite di rete. Catalogo: Fasce Arera F1/F2/F3 (P0).";

/** PDF business in `public/cte/duferco-fix-business/` (deployati con l’app). */
export const DUFERCO_FIX_BUSINESS_PDF_FILES = [
  {
    offerName: "FIX BUSINESS ANDANTE PLUS 24 MESI",
    filename: "FIX_BUSINESS_ANDANTE_PLUS_24_MESI.pdf",
  },
  {
    offerName: "FIX BUSINESS ANDANTE 24 MESI",
    filename: "FIX_BUSINESS_ANDANTE_24_MESI.pdf",
  },
  {
    offerName: "FIX BUSINESS ALLEGRO 24 MESI",
    filename: "FIX_BUSINESS_ALLEGRO_24_MESI.pdf",
  },
  {
    offerName: "FIX BUSINESS ADAGIO 24 MESI",
    filename: "FIX_BUSINESS_ADAGIO_24_MESI.pdf",
  },
  {
    offerName: "FIX BUSINESS SUPER ADAGIO 24 MESI",
    filename: "FIX_BUSINESS_SUPER_ADAGIO_24_MESI.pdf",
  },
] as const;

function luceOffer(opts: {
  offerName: string;
  f1: number;
  f2: number;
  f3: number;
  peak: number;
  offPeak: number;
  mono: number;
  ccvAnnual: number;
  codice: string;
  extraNotes?: string[];
}): CteListinoOffer {
  const fmt = (n: number) => String(n).replace(".", ",");
  return {
    supplierName: "Duferco Energia",
    offerName: opts.offerName,
    utility: "LUCE",
    category: "BUSINESS",
    commercialSegment: null,
    priceKind: "FISSO",
    bands: [
      { timeBand: "F1", energyPrice: opts.f1 },
      { timeBand: "F2", energyPrice: opts.f2 },
      { timeBand: "F3", energyPrice: opts.f3 },
    ],
    spread: null,
    ccvAnnual: opts.ccvAnnual,
    ccvMonthly: null,
    powerKwMin: null,
    powerKwMax: null,
    annualConsumptionMin: null,
    annualConsumptionMax: 30_000,
    networkLosses: "INCLUDED",
    validFrom: "2026-10-01",
    validTo: "2026-10-31",
    notes: [
      "Durata condizioni economiche: 24 mesi; dal 25° mese evoluzione automatica (PUN Index GME).",
      `Prezzi Fasce Arera F1 ${fmt(opts.f1)} / F2 ${fmt(opts.f2)} / F3 ${fmt(opts.f3)} €/kWh.`,
      `Mono ${fmt(opts.mono)} €/kWh; Peak ${fmt(opts.peak)} / Off Peak ${fmt(opts.offPeak)} €/kWh (solo POD orari; altrimenti Mono).`,
      `Codice offerta: ${opts.codice}.`,
      "Clienti business in bassa tensione con consumi fino a 30.000 kWh.",
      ...(opts.extraNotes ?? []),
      SOURCE,
    ].join(" "),
    warnings: [
      "Peak/Off Peak e Mono solo in nota: in catalogo applicate Fasce Arera F1/F2/F3.",
      "Potenza non indicata in kW sul PDF (solo bassa tensione).",
    ],
  };
}

/** 5 CTE luce business fisse — ottobre 2026 (sostituiscono le CTE omonime precedenti). */
export const DUFERCO_FIX_BUSINESS_LISTINO: CteListinoOffer[] = [
  luceOffer({
    offerName: "FIX BUSINESS ANDANTE PLUS 24 MESI",
    f1: 0.18332,
    f2: 0.19778,
    f3: 0.17046,
    peak: 0.18713,
    offPeak: 0.17811,
    mono: 0.18134,
    ccvAnnual: 180,
    codice: "003450ESFML02XX00000010074091026",
    extraNotes: ["Componente di sbilanciamento variabile CSV 0,00550 €/kWh."],
  }),
  luceOffer({
    offerName: "FIX BUSINESS ANDANTE 24 MESI",
    f1: 0.18442,
    f2: 0.19888,
    f3: 0.17156,
    peak: 0.18823,
    offPeak: 0.17921,
    mono: 0.18244,
    ccvAnnual: 180,
    codice: "003450ESFML02XX00000010073951026",
  }),
  luceOffer({
    offerName: "FIX BUSINESS ALLEGRO 24 MESI",
    f1: 0.18552,
    f2: 0.19998,
    f3: 0.17266,
    peak: 0.18933,
    offPeak: 0.18031,
    mono: 0.18354,
    ccvAnnual: 180,
    codice: "003450ESFML02XX00000010074031026",
  }),
  luceOffer({
    offerName: "FIX BUSINESS ADAGIO 24 MESI",
    f1: 0.18332,
    f2: 0.19778,
    f3: 0.17046,
    peak: 0.18713,
    offPeak: 0.17811,
    mono: 0.18134,
    ccvAnnual: 180,
    codice: "003450ESFML02XX00000010073921026",
  }),
  luceOffer({
    offerName: "FIX BUSINESS SUPER ADAGIO 24 MESI",
    f1: 0.18222,
    f2: 0.19668,
    f3: 0.16936,
    peak: 0.18603,
    offPeak: 0.17701,
    mono: 0.18024,
    ccvAnnual: 144,
    codice: "003450ESFML02XX00000010073911026",
  }),
];

export function isDufercoFixBusinessListinoText(text: string): boolean {
  const t = text.replace(/\s+/g, " ");
  return (
    /FIX\s*BUSINESS/i.test(t) &&
    /DUFERCO\s*ENERGIA/i.test(t) &&
    /(ANDANTE|ALLEGRO|ADAGIO)/i.test(t) &&
    /CLIENTI\s*BUSINESS/i.test(t)
  );
}

export function allDufercoFixBusinessOffers(): CteListinoOffer[] {
  return DUFERCO_FIX_BUSINESS_LISTINO;
}
