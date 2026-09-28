import type { CteListinoOffer } from "@/lib/cte-listino-shared";

/**
 * Listino Iren da Tovaglietta Iren-6 (settembre 2026).
 * Distinto da SEV Iren/Serviren (PDF OFFERTE SEV-10): stesso fornitore catalogo «Iren»,
 * nomi offerta diversi — non tocca il flusso SEV.
 *
 * Fonte: PDF scansionato (OCR); prezzi e quote verificati sulle card.
 */
export const IREN_TOVAGLIETTA_PDF_HASH =
  "b77674122a35f92961c48e34345685c628d905217bc827ccc381d7be1210bb73";

const SOURCE =
  "Fonte Tovaglietta Iren-6 (settembre 2026). Quota fissa usata come CCV catalogo.";

function n(months: number | null, extra: string[]): string {
  const bits = [
    months != null ? `Durata offerta: ${months} mesi.` : null,
    ...extra,
    SOURCE,
  ].filter((x): x is string => Boolean(x));
  return bits.join(" ");
}

function base(
  partial: Omit<
    CteListinoOffer,
    | "supplierName"
    | "ccvMonthly"
    | "powerKwMin"
    | "powerKwMax"
    | "annualConsumptionMin"
    | "annualConsumptionMax"
    | "validFrom"
    | "networkLosses"
  > & {
    powerKwMin?: number | null;
    powerKwMax?: number | null;
    annualConsumptionMin?: number | null;
    annualConsumptionMax?: number | null;
  },
): CteListinoOffer {
  const {
    powerKwMin = null,
    powerKwMax = null,
    annualConsumptionMin = null,
    annualConsumptionMax = null,
    ...rest
  } = partial;
  return {
    supplierName: "Iren",
    ccvMonthly: null,
    powerKwMin,
    powerKwMax,
    annualConsumptionMin,
    annualConsumptionMax,
    validFrom: null,
    networkLosses: null,
    ...rest,
  };
}

const VALID_FISSO = "2026-10-11";
const VALID_VAR = "2026-12-14";

/** Offerte fisse + variabili dalla Tovaglietta-6 (luce e gas come CTE separate). */
export const IREN_TOVAGLIETTA_LISTINO: CteListinoOffer[] = [
  // —— FISSO ——
  base({
    offerName: "SOTTOCASA NEW",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: null,
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.1581 }],
    spread: null,
    ccvAnnual: 159,
    powerKwMax: 10,
    annualConsumptionMax: 4000,
    validTo: VALID_FISSO,
    notes: n(null, [
      "Disponibilità limitata.",
      "Operazioni: switch, switch con voltura.",
      "Fatturazione bimestrale. Pagamento RID o bollettino postale.",
      "Limite: potenza ≤ 10 kW e consumo ≤ 4000 kWh/anno.",
    ]),
    warnings: [],
  }),
  base({
    offerName: "SOTTOCASA NEW",
    utility: "GAS",
    category: "RESIDENZIALE",
    commercialSegment: null,
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.725 }],
    spread: null,
    ccvAnnual: 156,
    annualConsumptionMax: 3000,
    validTo: VALID_FISSO,
    notes: n(null, [
      "Disponibilità limitata.",
      "Operazioni: switch, switch con voltura.",
      "Fatturazione bimestrale. Pagamento RID o bollettino postale.",
      "Limite: consumo ≤ 3000 Smc/anno.",
    ]),
    warnings: [],
  }),
  base({
    offerName: "IREN DAY PREZZO FISSO LUCE",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: null,
    priceKind: "FISSO",
    bands: [
      { timeBand: "F1", energyPrice: 0.1435 },
      { timeBand: "F2", energyPrice: 0.2031 },
      { timeBand: "F3", energyPrice: 0.2031 },
    ],
    spread: null,
    ccvAnnual: 147,
    validTo: VALID_FISSO,
    notes: n(null, [
      "Bonus −48 € in 2 anni (già riflesso nella quota fissa 147 vs 159 tipica).",
      "Operazioni: switch, switch con voltura.",
      "Fatturazione bimestrale. Pagamento RID.",
    ]),
    warnings: [],
  }),
  base({
    offerName: "IREN STAY TECH",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: null,
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.1548 }],
    spread: null,
    ccvAnnual: 159,
    validTo: VALID_FISSO,
    notes: n(null, [
      "Luce prezzo fisso; bundle tech (Nilox) indicato in tovaglietta.",
      "Operazioni: nuovo cliente (no nuovo allaccio).",
      "Fatturazione mensile. Pagamento RID.",
    ]),
    warnings: [],
  }),
  base({
    offerName: "IREN STAY",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: "CONNETTIVITÀ",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.159 }],
    spread: null,
    ccvAnnual: 159,
    validTo: VALID_FISSO,
    notes: n(null, [
      "Dedicata alla connettività.",
      "Operazioni: switch, switch con voltura.",
      "Fatturazione mensile. Pagamento RID.",
    ]),
    warnings: [],
  }),
  base({
    offerName: "IREN SMART NO STRESS",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: null,
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.1647 }],
    spread: null,
    ccvAnnual: 159,
    validTo: VALID_FISSO,
    notes: n(24, [
      "Offerta rata fissa 24 mesi; ricalcolo della rata dal 13° mese.",
      "Prezzo base listino 0,1647 €/kWh (CCV 159) usato per il calcolo rata.",
      "Operazioni: tutte le azioni commerciali (no nuovo allaccio).",
      "Fatturazione mensile. Pagamento RID.",
    ]),
    warnings: ["Prezzo energia da base calcolo rata; la rata mensile non è in catalogo."],
  }),
  base({
    offerName: "IREN SMART NO STRESS",
    utility: "GAS",
    category: "RESIDENZIALE",
    commercialSegment: null,
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.699 }],
    spread: null,
    ccvAnnual: 156,
    validTo: VALID_FISSO,
    notes: n(24, [
      "Offerta rata fissa 24 mesi; ricalcolo della rata dal 13° mese.",
      "Prezzo base listino 0,699 €/Smc (CCV 156).",
      "Operazioni: tutte le azioni commerciali (no nuovo allaccio).",
      "Fatturazione mensile. Pagamento RID.",
    ]),
    warnings: ["Prezzo energia da base calcolo rata; la rata mensile non è in catalogo."],
  }),
  base({
    offerName: "IREN TUA AZIENDA FISSO",
    utility: "LUCE",
    category: "BUSINESS",
    commercialSegment: "ALTRI USI",
    priceKind: "FISSO",
    bands: [
      { timeBand: "F1", energyPrice: 0.1928 },
      { timeBand: "F2", energyPrice: 0.1946 },
      { timeBand: "F3", energyPrice: 0.1871 },
    ],
    spread: null,
    ccvAnnual: 180,
    validTo: VALID_FISSO,
    notes: n(null, [
      "Offerta per altri usi.",
      "Operazioni: tutte le azioni commerciali.",
      "Fatturazione mensile. Pagamento RID.",
    ]),
    warnings: [],
  }),
  base({
    offerName: "IREN TUA AZIENDA FISSO",
    utility: "GAS",
    category: "BUSINESS",
    commercialSegment: "ALTRI USI",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.755 }],
    spread: null,
    ccvAnnual: 180,
    validTo: VALID_FISSO,
    notes: n(null, [
      "Offerta per altri usi.",
      "Operazioni: tutte le azioni commerciali.",
      "Fatturazione mensile. Pagamento RID.",
    ]),
    warnings: [],
  }),
  base({
    offerName: "IREN MULTISERVIZI LUCE FIX",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: "MULTISERVIZI",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.201 }],
    spread: null,
    ccvAnnual: 165,
    validTo: VALID_FISSO,
    notes: n(null, [
      "Bonus 4 € per i primi 24 mesi.",
      "Assicurazione multiservizi inclusa.",
      "Operazioni: tutte le azioni commerciali.",
      "Fatturazione mensile. Pagamento RID.",
    ]),
    warnings: [],
  }),
  base({
    offerName: "IREN REVOLUTION",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: null,
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.1961 }],
    spread: null,
    ccvAnnual: 165,
    validTo: VALID_FISSO,
    notes: n(null, [
      "Inclusa polizza sanitaria.",
      "Operazioni: tutte le azioni commerciali.",
      "Fatturazione mensile. Pagamento RID o bollettino postale.",
    ]),
    warnings: [],
  }),
  base({
    offerName: "IREN REVOLUTION",
    utility: "GAS",
    category: "RESIDENZIALE",
    commercialSegment: null,
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.798 }],
    spread: null,
    ccvAnnual: 162,
    validTo: VALID_FISSO,
    notes: n(null, [
      "Inclusa polizza sanitaria.",
      "Operazioni: tutte le azioni commerciali.",
      "Fatturazione mensile. Pagamento RID o bollettino postale.",
    ]),
    warnings: [],
  }),

  // —— VARIABILE ——
  base({
    offerName: "10 PER DUE",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: "PERTINENZE",
    priceKind: "VARIABILE",
    bands: [],
    spread: 0.0199,
    ccvAnnual: 75,
    validTo: VALID_VAR,
    notes: n(null, [
      "Spread: PUN + 0,0199 €/kWh.",
      "Offerta per pertinenze.",
      "Bonus 20 € (10 € 1° mese + 10 € 12° mese).",
      "Operazioni: tutte le azioni (no nuovo allaccio).",
      "Fatturazione bimestrale. Pagamento RID o bollettino postale.",
    ]),
    warnings: [],
  }),
  base({
    offerName: "10 PER TRE",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: null,
    priceKind: "VARIABILE",
    bands: [],
    spread: 0.0332,
    ccvAnnual: 159,
    validTo: VALID_VAR,
    notes: n(null, [
      "Spread: PUN + 0,0332 €/kWh.",
      "Bonus 30 € (10 € al 1°, 6° e 12° mese).",
      "Operazioni: subentri, prime attivazioni; tutte le azioni (no nuovo allaccio).",
      "Fatturazione bimestrale. Pagamento RID o bollettino postale.",
    ]),
    warnings: [],
  }),
  base({
    offerName: "10 PER TRE",
    utility: "GAS",
    category: "RESIDENZIALE",
    commercialSegment: null,
    priceKind: "VARIABILE",
    bands: [],
    spread: 0.23,
    ccvAnnual: 156,
    validTo: VALID_VAR,
    notes: n(null, [
      "Spread: PSV + 0,230 €/Smc.",
      "Bonus 30 € (10 € al 1°, 6° e 12° mese).",
      "Operazioni: subentri, prime attivazioni; tutte le azioni (no nuovo allaccio).",
      "Fatturazione bimestrale. Pagamento RID o bollettino postale.",
    ]),
    warnings: [],
  }),
  base({
    offerName: "IREN REVOLUTION VARIABILE",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: null,
    priceKind: "VARIABILE",
    bands: [],
    spread: 0.0332,
    ccvAnnual: 165,
    validTo: VALID_VAR,
    notes: n(null, [
      "Spread: PUN + 0,0332 €/kWh.",
      "Bonus 30 € (10 € al 1°, 6° e 12° mese).",
      "Operazioni: subentri, prime attivazioni; tutte le azioni commerciali.",
      "Fatturazione mensile. Pagamento RID o bollettino postale.",
    ]),
    warnings: [],
  }),
  base({
    offerName: "IREN REVOLUTION VARIABILE",
    utility: "GAS",
    category: "RESIDENZIALE",
    commercialSegment: null,
    priceKind: "VARIABILE",
    bands: [],
    spread: 0.23,
    ccvAnnual: 162,
    validTo: VALID_VAR,
    notes: n(null, [
      "Spread: PSV + 0,230 €/Smc.",
      "Bonus 30 € (10 € al 1°, 6° e 12° mese).",
      "Operazioni: subentri, prime attivazioni; tutte le azioni commerciali.",
      "Fatturazione mensile. Pagamento RID o bollettino postale.",
    ]),
    warnings: [],
  }),
  base({
    offerName: "SOTTO CASA VARIABILE",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: null,
    priceKind: "VARIABILE",
    bands: [],
    spread: 0.02,
    ccvAnnual: 159,
    validTo: VALID_VAR,
    notes: n(null, [
      "Spread: PUN + 0,02 €/kWh.",
      "Bonus 36 € 1° anno (6×6 €) + 24 € 2° anno (3×8 €).",
      "Operazioni: tutte le azioni (no nuovo allaccio).",
      "Fatturazione bimestrale. Pagamento RID o bollettino postale.",
    ]),
    warnings: ["Quota fissa luce OCR parziale sulla card; confermata 159 €/anno come Sottocasa fisso."],
  }),
  base({
    offerName: "SOTTO CASA VARIABILE",
    utility: "GAS",
    category: "RESIDENZIALE",
    commercialSegment: null,
    priceKind: "VARIABILE",
    bands: [],
    spread: 0.15,
    ccvAnnual: 156,
    validTo: VALID_VAR,
    notes: n(null, [
      "Spread: PSV + 0,15 €/Smc.",
      "Bonus 36 € 1° anno + 24 € 2° anno.",
      "Operazioni: tutte le azioni (no nuovo allaccio).",
      "Fatturazione bimestrale. Pagamento RID o bollettino postale.",
    ]),
    warnings: [],
  }),
  base({
    offerName: "IREN TUA AZIENDA LUCE VARIABILE TOP",
    utility: "LUCE",
    category: "BUSINESS",
    commercialSegment: "ALTRI USI",
    priceKind: "VARIABILE",
    bands: [],
    spread: 0.0143,
    ccvAnnual: 180,
    annualConsumptionMin: 25000,
    validTo: VALID_VAR,
    notes: n(null, [
      "Spread: PUN + 0,0143 €/kWh.",
      "A partire da 25.000 kWh/anno.",
      "Offerta per altri usi.",
      "Operazioni: tutte le azioni commerciali.",
      "Fatturazione bimestrale. Pagamento RID.",
    ]),
    warnings: [],
  }),
  base({
    offerName: "IREN TUA AZIENDA LUCE VARIABILE TOP",
    utility: "GAS",
    category: "BUSINESS",
    commercialSegment: "ALTRI USI",
    priceKind: "VARIABILE",
    bands: [],
    spread: 0.115,
    ccvAnnual: 180,
    annualConsumptionMin: 10000,
    validTo: VALID_VAR,
    notes: n(null, [
      "Spread: PSV + 0,115 €/Smc.",
      "A partire da 10.000 Smc/anno.",
      "Offerta per altri usi.",
      "Operazioni: tutte le azioni commerciali.",
      "Fatturazione bimestrale. Pagamento RID.",
    ]),
    warnings: [],
  }),
  base({
    offerName: "IREN SMALL MULTI VARIABILE",
    utility: "LUCE",
    category: "RESIDENZIALE",
    commercialSegment: "MULTISERVIZI",
    priceKind: "VARIABILE",
    bands: [],
    spread: 0.0165,
    ccvAnnual: 159,
    validTo: VALID_VAR,
    notes: n(null, [
      "Spread: PUN + 0,0165 €/kWh.",
      "Bonus 8 € dal 1° al 6° mese + 4 € dal 7° al 24° mese.",
      "Assicurazione multiservizi inclusa.",
      "Operazioni: nuovi clienti (no nuovo allaccio).",
      "Fatturazione mensile. Pagamento RID o bollettino postale.",
    ]),
    warnings: [],
  }),
  base({
    offerName: "IREN SMALL MULTI VARIABILE",
    utility: "GAS",
    category: "RESIDENZIALE",
    commercialSegment: "MULTISERVIZI",
    priceKind: "VARIABILE",
    bands: [],
    spread: 0.1,
    ccvAnnual: 156,
    validTo: VALID_VAR,
    notes: n(null, [
      "Spread: PSV + 0,10 €/Smc.",
      "Bonus 8 € dal 1° al 6° mese + 4 € dal 7° al 24° mese.",
      "Assicurazione multiservizi inclusa.",
      "Operazioni: nuovi clienti (no nuovo allaccio).",
      "Fatturazione mensile. Pagamento RID o bollettino postale.",
    ]),
    warnings: [],
  }),
  base({
    offerName: "IREN TUA AZIENDA LUCE VARIABILE",
    utility: "LUCE",
    category: "BUSINESS",
    commercialSegment: "ALTRI USI",
    priceKind: "VARIABILE",
    bands: [],
    spread: 0.0198,
    ccvAnnual: 180,
    validTo: VALID_VAR,
    notes: n(null, [
      "Spread: PUN + 0,0198 €/kWh.",
      "Offerta per altri usi.",
      "Operazioni: tutte le azioni commerciali.",
      "Fatturazione mensile. Pagamento RID.",
    ]),
    warnings: [],
  }),
  base({
    offerName: "IREN TUA AZIENDA LUCE VARIABILE",
    utility: "GAS",
    category: "BUSINESS",
    commercialSegment: "ALTRI USI",
    priceKind: "VARIABILE",
    bands: [],
    spread: 0.14,
    ccvAnnual: 180,
    validTo: VALID_VAR,
    notes: n(null, [
      "Spread: PSV + 0,14 €/Smc.",
      "Offerta per altri usi.",
      "Operazioni: tutte le azioni commerciali.",
      "Fatturazione mensile. Pagamento RID.",
    ]),
    warnings: [],
  }),
];

export function isIrenTovagliettaListinoText(text: string): boolean {
  const t = text.replace(/\s+/g, " ");
  return (
    /SOTTOCASA\s*NEW/i.test(t) &&
    /IREN\s*DAY\s*PREZZO\s*FISSO/i.test(t) &&
    /10\s*PER\s*DUE/i.test(t)
  );
}
