/**
 * P1.4 — mappatura UI flusso Back Office sugli stati ContractStatus esistenti.
 * Nessun nuovo enum: solo etichette e fasi per tracciamento presa in carico.
 */

import type { AppContractStatus } from "@/lib/constants";
import { CONTRACT_STATUS_LABELS } from "@/lib/constants";

/** Fasi UI: Inviato al BO → In lavorazione → Conclusa (+ integrazione). */
export type BackOfficeFlowPhase =
  | "bozza"
  | "inserito"
  | "inviato_bo"
  | "in_lavorazione"
  | "richiesta_integrazione"
  | "conclusa"
  | "ko"
  | "altro";

export type BackOfficeFlowStep = {
  id: BackOfficeFlowPhase;
  label: string;
  /** true se la pratica ha raggiunto o superato questo step */
  reached: boolean;
  /** true se è lo step corrente */
  current: boolean;
};

/**
 * Mappa stato Prisma → fase UI P1.4.
 * DA_LAVORARE / INVIATO_AL_MASTER / INVIATO_AL_FORNITORE = «Inviato al BO»
 * IN_LAVORAZIONE = «In lavorazione»
 * DOCUMENTAZIONE_INCOMPLETA = «Richiesta integrazione»
 * Esiti positivi / pagamento = «Conclusa»
 */
export function mapStatusToBackOfficePhase(
  status: string,
  opts?: { sendToMaster?: boolean; assignedToMaster?: boolean },
): BackOfficeFlowPhase {
  switch (status) {
    case "BOZZA":
      return "bozza";
    case "INSERITO":
    case "DA_CONTROLLARE":
    case "DOCUMENTAZIONE_COMPLETA":
      if (opts?.sendToMaster || opts?.assignedToMaster) return "inviato_bo";
      return "inserito";
    case "DA_LAVORARE":
    case "INVIATO_AL_MASTER":
    case "INVIATO_AL_FORNITORE":
    case "ERRORE_INVIO":
      return "inviato_bo";
    case "IN_LAVORAZIONE":
      return "in_lavorazione";
    case "DOCUMENTAZIONE_INCOMPLETA":
      return "richiesta_integrazione";
    case "KO":
    case "ANNULLATO":
      return "ko";
    case "IN_ATTESA_PAGAMENTO":
    case "ATTIVATO":
    case "PAGATO_DAL_FORNITORE":
    case "PROVVIGIONE_LIQUIDATA":
    case "COMPLETATO":
    case "CHIUSO":
    case "STORNATO":
      return "conclusa";
    default:
      return "altro";
  }
}

export const BACK_OFFICE_PHASE_LABELS: Record<BackOfficeFlowPhase, string> = {
  bozza: "Bozza",
  inserito: "Inserito",
  inviato_bo: "Inviato al Back Office",
  in_lavorazione: "In lavorazione",
  richiesta_integrazione: "Richiesta integrazione",
  conclusa: "Conclusa",
  ko: "KO / Annullato",
  altro: "Altro",
};

/**
 * Pipeline lineare mostrata in scheda / riepilogo.
 * La richiesta integrazione è un ramo laterale su «In lavorazione».
 */
export function buildBackOfficeFlowSteps(
  status: string,
  opts?: { sendToMaster?: boolean; assignedToMaster?: boolean },
): BackOfficeFlowStep[] {
  const phase = mapStatusToBackOfficePhase(status, opts);
  const order: BackOfficeFlowPhase[] = [
    "inserito",
    "inviato_bo",
    "in_lavorazione",
    "conclusa",
  ];

  if (phase === "bozza") {
    return [
      {
        id: "bozza",
        label: BACK_OFFICE_PHASE_LABELS.bozza,
        reached: true,
        current: true,
      },
      ...order.map((id) => ({
        id,
        label: BACK_OFFICE_PHASE_LABELS[id],
        reached: false,
        current: false,
      })),
    ];
  }

  if (phase === "richiesta_integrazione") {
    return [
      {
        id: "inserito",
        label: BACK_OFFICE_PHASE_LABELS.inserito,
        reached: true,
        current: false,
      },
      {
        id: "inviato_bo",
        label: BACK_OFFICE_PHASE_LABELS.inviato_bo,
        reached: true,
        current: false,
      },
      {
        id: "in_lavorazione",
        label: BACK_OFFICE_PHASE_LABELS.in_lavorazione,
        reached: true,
        current: false,
      },
      {
        id: "richiesta_integrazione",
        label: BACK_OFFICE_PHASE_LABELS.richiesta_integrazione,
        reached: true,
        current: true,
      },
      {
        id: "conclusa",
        label: BACK_OFFICE_PHASE_LABELS.conclusa,
        reached: false,
        current: false,
      },
    ];
  }

  if (phase === "ko") {
    return [
      {
        id: "inserito",
        label: BACK_OFFICE_PHASE_LABELS.inserito,
        reached: true,
        current: false,
      },
      {
        id: "inviato_bo",
        label: BACK_OFFICE_PHASE_LABELS.inviato_bo,
        reached: true,
        current: false,
      },
      {
        id: "in_lavorazione",
        label: BACK_OFFICE_PHASE_LABELS.in_lavorazione,
        reached: true,
        current: false,
      },
      {
        id: "ko",
        label: BACK_OFFICE_PHASE_LABELS.ko,
        reached: true,
        current: true,
      },
    ];
  }

  const currentIdx = order.indexOf(
    phase === "altro" ? "inserito" : (phase as (typeof order)[number]),
  );
  const idx = currentIdx < 0 ? 0 : currentIdx;

  return order.map((id, i) => ({
    id,
    label: BACK_OFFICE_PHASE_LABELS[id],
    reached: i <= idx,
    current: i === idx,
  }));
}

/** Etichetta UI primaria per badge stato (mantiene CONTRACT_STATUS_LABELS). */
export function backOfficeStatusUiLabel(status: string): string {
  const phase = mapStatusToBackOfficePhase(status);
  if (
    phase === "inviato_bo" ||
    phase === "in_lavorazione" ||
    phase === "richiesta_integrazione" ||
    phase === "conclusa" ||
    phase === "ko" ||
    phase === "bozza" ||
    phase === "inserito"
  ) {
    return BACK_OFFICE_PHASE_LABELS[phase];
  }
  return (
    CONTRACT_STATUS_LABELS[status as AppContractStatus] ?? status
  );
}

/**
 * Stato Prisma usato all’invio al BO (coerente con enqueue esistente).
 * Non introduce enum nuovi.
 */
export const SEND_TO_BACKOFFICE_STATUS: AppContractStatus = "IN_LAVORAZIONE";

/** Stati da cui l’UI «Invia al BO» può partire. */
export const PRE_BACKOFFICE_STATUSES: ReadonlySet<string> = new Set([
  "BOZZA",
  "INSERITO",
  "DOCUMENTAZIONE_COMPLETA",
  "DOCUMENTAZIONE_INCOMPLETA",
  "DA_CONTROLLARE",
  "DA_LAVORARE",
]);
