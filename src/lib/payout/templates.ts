/**
 * Preset delle mappature per le fonti già analizzate.
 *
 * Servono come punto di partenza: l'utente li seleziona invece di costruire la
 * mappatura da zero, e da lì la modifica. Una volta salvati diventano righe
 * `ImportTemplate` a database, quindi modificabili senza deploy.
 *
 * Riferimento: `docs/provvigioni-formati-e-import.md`, §1.
 */

import type { PayoutTemplateConfig } from "@/lib/payout/types";

export type PayoutBuiltinTemplate = {
  key: string;
  label: string;
  /** Cosa riconosce l'utente del proprio file */
  hint: string;
  sourceKind: "SUPPLIER_STATEMENT" | "MASTER_STATEMENT" | "MARKETPLACE" | "OTHER";
  config: PayoutTemplateConfig;
};

const BUILTIN_TEMPLATES: PayoutBuiltinTemplate[] = [
  {
    key: "vendite_dirette",
    label: "Agenzia — Dettaglio vendite dirette",
    hint: "Foglio «Dettaglio Vendite Dirette» con colonna «Cod.Ute.» e foglio «Riepilogo»",
    sourceKind: "SUPPLIER_STATEMENT",
    config: {
      sheetMatch: { mode: "all", skip: ["riepilogo"] },
      headerRow: 1,
      columnMap: {
        pod: "Cod.Ute.",
        clientName: "Intestatario contratto",
        amount: "Totale Provvigione Cliente",
        amountComponents: [
          "Provvigione Base (Regola 1)",
          "Bonus SDD Ricorrente (Regola 2b)",
          "Bonus Apertura (Regola 3)",
        ],
        collaborator: "Agente",
        note: "Offerta",
      },
      numberFormat: {},
      dateFormat: "it",
      skipRules: { stopAtTotalRow: true, requireColumns: ["pod"] },
      declaredTotal: {
        mode: "label_lookup",
        sheet: "Riepilogo",
        label: "NETTO DA PAGARE",
      },
    },
  },
  {
    key: "documento_pagamento",
    label: "Master — Documento di pagamento",
    hint: "Fogli «Compensi», «Storni», «Compensi Ricorrenti»… con colonna «ID Mov.»",
    sourceKind: "MASTER_STATEMENT",
    config: {
      sheetMatch: { mode: "all", skip: ["totale"] },
      headerRow: 1,
      columnMap: {
        pod: "PDR/POD/Tel/...",
        clientName: "Ragione Sociale",
        fiscalCode: "Codice Fiscale",
        amount: "Importo",
        period: "Dt. Operazione",
        supplier: "Partner",
        note: "Descrizione",
      },
      numberFormat: {
        // Gli storni arrivano positivi su fogli dedicati: il segno va invertito
        sheetSign: {
          Storni: -1,
          "Storni Ricorrenti": -1,
          "Altro Storni": -1,
        },
      },
      dateFormat: "it_dash",
      skipRules: { stopAtTotalRow: true, requireColumns: ["amount"] },
      declaredTotal: { mode: "total_rows" },
    },
  },
  {
    key: "invito_fatturare_am",
    label: "Fornitore — Invito a fatturare (Area Manager)",
    hint: "Fogli «Consumer e Microbusiness» e «Corporate», POD mascherato con asterischi",
    sourceKind: "SUPPLIER_STATEMENT",
    config: {
      sheetMatch: { mode: "regex", value: "consumer|microbusiness|corporate" },
      headerRow: 1,
      columnMap: {
        pod: "POD PDR",
        clientLastName: "Cliente",
        amount: "IMPORTO EURO",
        period: "PRIMA COMPETENZA",
        collaborator: "Agente",
        note: "DSC GETTONE",
      },
      numberFormat: {},
      dateFormat: "month_abbr",
      skipRules: { stopAtTotalRow: true, requireColumns: ["amount"] },
      declaredTotal: { mode: "total_rows" },
    },
  },
  {
    key: "marketplace",
    label: "Comparatore — Dettaglio inviti",
    hint: "Colonne «Shop», «Nominativo», «Codice Pod/Pdr», «Gettone»",
    sourceKind: "MARKETPLACE",
    config: {
      sheetMatch: { mode: "all" },
      headerRow: 1,
      columnMap: {
        pod: "Codice Pod/Pdr",
        clientName: "Nominativo",
        amount: "Gettone",
        period: "Data",
        supplier: "Prodotto Pivot",
        collaborator: "Shop",
        note: "Note",
        status: "Stato",
      },
      numberFormat: {},
      dateFormat: "excel",
      skipRules: {
        stopAtTotalRow: true,
        requireColumns: ["pod", "amount"],
        allowedStatus: ["OK"],
      },
      declaredTotal: { mode: "none" },
    },
  },
];

export function listBuiltinTemplates(): PayoutBuiltinTemplate[] {
  return BUILTIN_TEMPLATES;
}

export function findBuiltinTemplate(
  key: string,
): PayoutBuiltinTemplate | null {
  return BUILTIN_TEMPLATES.find((t) => t.key === key) ?? null;
}

/** Mappatura minima usata quando l'utente parte da un file sconosciuto. */
export function emptyTemplateConfig(): PayoutTemplateConfig {
  return {
    sheetMatch: { mode: "all" },
    headerRow: 0,
    columnMap: {},
    numberFormat: {},
    dateFormat: "auto",
    skipRules: { stopAtTotalRow: true },
    declaredTotal: { mode: "none" },
  };
}
