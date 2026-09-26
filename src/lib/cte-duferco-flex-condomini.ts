import type { CteListinoOffer } from "@/lib/cte-listino-shared";

/** Note comuni: Michele — le CTE Flex Condomini non scadono mai (PDF ha periodo adesione). */
const NEVER_EXPIRE_NOTE =
  "Non scade (indicazione Michele). PDF: periodo validità CTE 01/07/2026–30/09/2026 ignorato.";

function luce(
  planet: string,
  spread: number,
  ccvAnnual: number,
): CteListinoOffer {
  return {
    supplierName: "Duferco Energia",
    offerName: `FLEX CONDOMINI ${planet}`,
    utility: "LUCE",
    category: "CONDOMINI",
    commercialSegment: null,
    priceKind: "VARIABILE",
    bands: [],
    spread,
    ccvAnnual,
    ccvMonthly: null,
    powerKwMin: null,
    powerKwMax: null,
    annualConsumptionMin: null,
    annualConsumptionMax: null,
    networkLosses: "INCLUDED",
    validFrom: null,
    validTo: null,
    notes: [
      NEVER_EXPIRE_NOTE,
      `Spread: P = (1+λ)×PUNHH + ${String(spread).replace(".", ",")} €/kWh (λ=0,1 BT).`,
      "QCV Duferco usata come CCV catalogo. Prezzi al lordo delle perdite di rete.",
    ].join(" "),
    warnings: [],
  };
}

function gas(
  planet: string,
  spread: number,
  cmod: number | null,
): CteListinoOffer {
  const notes = [
    NEVER_EXPIRE_NOTE,
    `Spread: P = PSV + ${String(spread).replace(".", ",")} €/Smc.`,
    "CVD fissa 108 €/PdR/anno usata come CCV catalogo.",
  ];
  if (cmod != null) {
    notes.push(`CMOD variabile ${String(cmod).replace(".", ",")} €/Smc (solo in nota).`);
  }
  return {
    supplierName: "Duferco Energia",
    offerName: `FLEX CONDOMINI ${planet}`,
    utility: "GAS",
    category: "CONDOMINI",
    commercialSegment: null,
    priceKind: "VARIABILE",
    bands: [],
    spread,
    ccvAnnual: 108,
    ccvMonthly: null,
    powerKwMin: null,
    powerKwMax: null,
    annualConsumptionMin: null,
    annualConsumptionMax: null,
    networkLosses: "NOT_APPLICABLE",
    validFrom: null,
    validTo: null,
    notes: notes.join(" "),
    warnings: [],
  };
}

/** 8 luce + 10 gas Flex Condomini Duferco (catalogo CONDOMINI, senza scadenza). */
export const DUFERCO_FLEX_CONDOMINI_LISTINO: CteListinoOffer[] = [
  luce("MERCURIO", 0.0132, 120),
  luce("VENERE", 0.0165, 150),
  luce("TERRA", 0.0165, 180),
  luce("MARTE", 0.022, 210),
  luce("GIOVE", 0.033, 240),
  luce("SATURNO", 0.033, 300),
  luce("URANO", 0.044, 360),
  luce("NETTUNO", 0.044, 420),
  gas("SOLE", 0.05, null),
  gas("LUNA", 0.07, null),
  gas("MERCURIO", 0.09, null),
  gas("VENERE", 0.12, null),
  gas("TERRA", 0.15, null),
  gas("MARTE", 0.15, 0.03),
  gas("GIOVE", 0.17, 0.04),
  gas("SATURNO", 0.19, 0.05),
  gas("URANO", 0.21, 0.06),
  gas("NETTUNO", 0.23, 0.07),
];

export function allDufercoFlexCondominiOffers(): CteListinoOffer[] {
  return DUFERCO_FLEX_CONDOMINI_LISTINO;
}
