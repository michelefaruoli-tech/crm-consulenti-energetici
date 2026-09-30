/**
 * P1.4 — indicatore completezza pratica (form nuovo contratto).
 * Solo UI: non altera calcoli provvigioni / storno.
 *
 * Regola invio BO: dati minimi + almeno un allegato.
 * Checklist documenti mancanti → warning (integrazione), non hard-block.
 */

import {
  evaluateDocumentChecklist,
  type DocumentChecklistInput,
} from "@/lib/document-checklist";

export type CompletenessFieldInput = {
  clientOk: boolean;
  addressOk: boolean;
  /** Almeno un POD/PDR/codice utenza significativo */
  utenzaOk: boolean;
  supplierOk: boolean;
  operationOk: boolean;
  paymentOk: boolean;
  offerOk: boolean;
  datesOk: boolean;
  checklist: DocumentChecklistInput;
  attachments: ReadonlyArray<{ docType?: string | null; filename?: string | null }>;
};

export type CompletenessResult = {
  /** 0–100 */
  percent: number;
  label: string;
  blocks: Array<{
    id: string;
    label: string;
    ok: boolean;
    weight: number;
  }>;
  docs: ReturnType<typeof evaluateDocumentChecklist>;
  canSaveDraft: boolean;
  canSaveInserito: boolean;
  canSendToBackOffice: boolean;
  /** Blocchi hard: senza questi non si può inviare al BO */
  blockersForBackOffice: string[];
  /** Avvisi amber: documenti checklist da integrare (non bloccano se c’è almeno un allegato) */
  warningsForBackOffice: string[];
};

/**
 * Pesi progressivi allineati ai 7 blocchi form (documenti pesano di più per BO).
 */
export function computeContractCompleteness(
  input: CompletenessFieldInput,
): CompletenessResult {
  const docs = evaluateDocumentChecklist(input.checklist, input.attachments);
  const hasAttachment = input.attachments.length > 0;

  const blocks = [
    { id: "cliente", label: "Cliente", ok: input.clientOk, weight: 15 },
    { id: "utenza", label: "Utenza / POD-PDR", ok: input.utenzaOk, weight: 15 },
    {
      id: "fornitore",
      // Solo fornitore: offerta/prodotto non deve far risultare «incompleto»
      // se Enel (o altro) è già selezionato.
      label: "Fornitore e servizio",
      ok: input.supplierOk,
      weight: 15,
    },
    {
      id: "contratto",
      label: "Dati contrattuali",
      ok: input.operationOk && input.paymentOk && input.datesOk && input.addressOk,
      weight: 20,
    },
    {
      id: "documenti",
      label: "Documenti richiesti",
      ok: docs.requiredComplete,
      weight: 25,
    },
    {
      id: "allegati",
      label: "Almeno un allegato",
      ok: hasAttachment,
      weight: 10,
    },
  ];

  const totalWeight = blocks.reduce((s, b) => s + b.weight, 0);
  const earned = blocks.reduce((s, b) => s + (b.ok ? b.weight : 0), 0);
  const percent = Math.round((earned / totalWeight) * 100);

  const blockersForBackOffice: string[] = [];
  if (!input.clientOk) blockersForBackOffice.push("Dati cliente incompleti");
  if (!input.addressOk) blockersForBackOffice.push("Indirizzo incompleto");
  if (!input.utenzaOk) blockersForBackOffice.push("POD/PDR o codice utenza mancante");
  if (!input.supplierOk) blockersForBackOffice.push("Fornitore mancante");
  if (!input.operationOk) blockersForBackOffice.push("Tipo operazione mancante");
  if (!input.paymentOk) blockersForBackOffice.push("Metodo di pagamento mancante");
  if (!hasAttachment) {
    blockersForBackOffice.push("Allega almeno un documento");
  }

  const warningsForBackOffice: string[] = [];
  for (const label of docs.missingRequiredLabels) {
    warningsForBackOffice.push(
      `Documento da integrare (non blocca l’invio): ${label}`,
    );
  }
  if (!input.offerOk && input.supplierOk) {
    warningsForBackOffice.push(
      "Offerta / prodotto non indicato (facoltativo per l’invio)",
    );
  }

  const canSaveDraft = input.clientOk || input.utenzaOk || input.supplierOk;
  const canSaveInserito =
    input.clientOk &&
    input.utenzaOk &&
    input.supplierOk &&
    input.operationOk;
  /** Invio BO: dati minimi + almeno un allegato. Checklist mancante = warning. */
  const canSendToBackOffice =
    canSaveInserito &&
    input.addressOk &&
    input.paymentOk &&
    hasAttachment;

  let label = "Pratica incompleta";
  if (percent >= 100) label = "Contratto completo";
  else if (canSendToBackOffice && warningsForBackOffice.length > 0) {
    label = "Pronto per il BO (documenti da integrare)";
  } else if (percent >= 75) label = "Quasi completo";
  else if (percent >= 40) label = "In compilazione";
  else label = "All’inizio";

  return {
    percent,
    label,
    blocks,
    docs,
    canSaveDraft,
    canSaveInserito,
    canSendToBackOffice,
    blockersForBackOffice,
    warningsForBackOffice,
  };
}
