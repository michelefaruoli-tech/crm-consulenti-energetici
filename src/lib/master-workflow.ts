import type { AppContractStatus } from "@/lib/constants";

/**
 * Stati operativi Master (dopo invio pratica).
 * Flusso: In lavorazione → In pagamento | Richiesta integrazione | KO
 */
export const MASTER_WORKFLOW_STATUSES = [
  "IN_LAVORAZIONE",
  "IN_ATTESA_PAGAMENTO",
  "DOCUMENTAZIONE_INCOMPLETA",
  "KO",
] as const;

export type MasterWorkflowStatus = (typeof MASTER_WORKFLOW_STATUSES)[number];

export const MASTER_STATUS_LABELS: Record<MasterWorkflowStatus, string> = {
  IN_LAVORAZIONE: "In lavorazione",
  IN_ATTESA_PAGAMENTO: "In pagamento",
  DOCUMENTAZIONE_INCOMPLETA: "Richiesta integrazione",
  KO: "KO",
};

/** Solo gli esiti finali della lavorazione (3 scelte utente). */
export const MASTER_OUTCOME_STATUSES = [
  "IN_ATTESA_PAGAMENTO",
  "DOCUMENTAZIONE_INCOMPLETA",
  "KO",
] as const;

export const KO_REASON_OPTIONS = [
  { value: "DOC_INCOMPLETA", label: "Documentazione incompleta" },
  { value: "DATI_ERRATI", label: "Dati cliente errati" },
  { value: "NON_CONTATTABILE", label: "Cliente non contattabile" },
  { value: "RIFIUTATA_FORNITORE", label: "Pratica rifiutata dal fornitore" },
  { value: "POD_PDR_INVALIDO", label: "POD/PDR non valido" },
  { value: "CREDITO", label: "Problemi di credito" },
  { value: "ANNULLATO_CLIENTE", label: "Contratto annullato dal cliente" },
  { value: "DUPLICATO", label: "Contratto duplicato" },
  { value: "IMPOSSIBILITA_TECNICA", label: "Impossibilità tecnica" },
  { value: "ALTRO", label: "Altro" },
] as const;

const TRANSITIONS: Record<MasterWorkflowStatus, MasterWorkflowStatus[]> = {
  IN_LAVORAZIONE: [
    "IN_ATTESA_PAGAMENTO",
    "DOCUMENTAZIONE_INCOMPLETA",
    "KO",
  ],
  DOCUMENTAZIONE_INCOMPLETA: [
    "IN_LAVORAZIONE",
    "IN_ATTESA_PAGAMENTO",
    "KO",
  ],
  IN_ATTESA_PAGAMENTO: ["KO", "DOCUMENTAZIONE_INCOMPLETA"],
  KO: ["IN_LAVORAZIONE", "DOCUMENTAZIONE_INCOMPLETA"],
};

export function isMasterWorkflowStatus(
  status: string,
): status is MasterWorkflowStatus {
  return (MASTER_WORKFLOW_STATUSES as readonly string[]).includes(status);
}

export function canTransitionMasterStatus(
  from: string,
  to: string,
  allowAdminOverride: boolean,
): boolean {
  if (!isMasterWorkflowStatus(to)) return false;
  if (allowAdminOverride) return true;
  // Da stati legacy / attesa si può passare agli esiti Master
  if (
    from === "IN_ATTESA_PAGAMENTO" ||
    from === "ATTIVATO" ||
    from === "DA_LAVORARE" ||
    from === "INVIATO_AL_MASTER" ||
    from === "DOCUMENTAZIONE_COMPLETA" ||
    from === "DOCUMENTAZIONE_INCOMPLETA"
  ) {
    return (
      to === "IN_ATTESA_PAGAMENTO" ||
      to === "DOCUMENTAZIONE_INCOMPLETA" ||
      to === "KO" ||
      to === "IN_LAVORAZIONE"
    );
  }
  if (!isMasterWorkflowStatus(from)) {
    return (
      to === "IN_LAVORAZIONE" ||
      to === "IN_ATTESA_PAGAMENTO" ||
      to === "DOCUMENTAZIONE_INCOMPLETA" ||
      to === "KO"
    );
  }
  if (from === to) return false;
  return TRANSITIONS[from].includes(to);
}

export function validateMasterTransition(opts: {
  from: string;
  to: string;
  allowAdminOverride: boolean;
  koReason?: string;
  koNotes?: string;
  koOtherText?: string;
  activationDate?: string;
  paymentDate?: string;
  paymentConfirmed?: boolean;
  integrationNotes?: string;
}): string[] {
  const errors: string[] = [];
  if (!canTransitionMasterStatus(opts.from, opts.to, opts.allowAdminOverride)) {
    errors.push(
      `Transizione non consentita: ${opts.from} → ${opts.to}. ` +
        `Esiti: In pagamento · Richiesta integrazione · KO.`,
    );
  }
  if (opts.to === "KO") {
    if (!opts.koReason?.trim()) errors.push("Motivo del KO obbligatorio");
    if (opts.koReason === "ALTRO" && !opts.koOtherText?.trim()) {
      errors.push("Specifica il motivo KO (Altro)");
    }
    if (!opts.koNotes?.trim()) errors.push("Note sul KO obbligatorie");
  }
  if (opts.to === "DOCUMENTAZIONE_INCOMPLETA" && !opts.integrationNotes?.trim() && !opts.koNotes?.trim()) {
    errors.push("Indica quali dati integrativi mancano");
  }
  return errors;
}

export function daysSince(date: Date | string | null | undefined): number | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  const ms = Date.now() - d.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

export function isStaleMasterPractice(
  sentAt: Date | string | null | undefined,
  status: AppContractStatus | string,
): boolean {
  if (status !== "IN_LAVORAZIONE") return false;
  const d = daysSince(sentAt);
  return d != null && d >= 3;
}
