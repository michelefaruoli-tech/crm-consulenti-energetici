/**
 * Mappatura Compara «Dettaglio inviti» per l'import dedicato agosto.
 * Differenza rispetto al preset marketplace: POD non obbligatorio
 * (Fagiano spesso non lo valorizza) e date in formato italiano testuale.
 */

import type { PayoutTemplateConfig } from "@/lib/payout/types";

export const COMPARA_AGOSTO_TEMPLATE_KEY = "compara_agosto";

export const COMPARA_AGOSTO_TEMPLATE_LABEL =
  "Compara — Inviti pagati (regole Faruoli/Fagiano/altri)";

export const COMPARA_AGOSTO_TEMPLATE_HINT =
  "Stato OK · Nominativo · Shop · Prodotto Pivot · Codice Pod/Pdr (opzionale) · importi da regola (Faruoli/Lucio 80, Fagiano 70/65, altri 70/60)";

export function comparaAgostoTemplateConfig(): PayoutTemplateConfig {
  return {
    sheetMatch: { mode: "all" },
    headerRow: 1,
    columnMap: {
      pod: "Codice Pod/Pdr",
      clientName: "Nominativo",
      amount: "Gettone",
      period: "Data",
      supplier: "Prodotto Pivot",
      collaborator: "Shop",
      note: "Note Storno",
      status: "Stato",
    },
    numberFormat: {},
    dateFormat: "auto",
    skipRules: {
      stopAtTotalRow: true,
      // POD non richiesto: Fagiano spesso lo lascia vuoto
      requireColumns: ["clientName", "amount"],
      allowedStatus: ["OK"],
    },
    declaredTotal: { mode: "none" },
  };
}
