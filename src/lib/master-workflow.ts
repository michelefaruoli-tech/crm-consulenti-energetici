import type { AppContractStatus } from "@/lib/constants";

/** Stati operativi Master (flusso semplificato) */
export const MASTER_WORKFLOW_STATUSES = [
  "IN_LAVORAZIONE",
  "COMPLETATO",
  "KO",
] as const;

export type MasterWorkflowStatus = (typeof MASTER_WORKFLOW_STATUSES)[number];

export const MASTER_STATUS_LABELS: Record<MasterWorkflowStatus, string> = {
  IN_LAVORAZIONE: "In lavorazione",
  COMPLETATO: "Completato",
  KO: "KO",
};

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
  IN_LAVORAZIONE: ["COMPLETATO", "KO"],
  COMPLETATO: [],
  KO: [],
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
  // Legacy: da attesa/attivato si può chiudere a COMPLETATO o KO
  if (
    from === "IN_ATTESA_PAGAMENTO" ||
    from === "ATTIVATO" ||
    from === "DA_LAVORARE" ||
    from === "INVIATO_AL_MASTER"
  ) {
    return to === "COMPLETATO" || to === "KO" || to === "IN_LAVORAZIONE";
  }
  if (!isMasterWorkflowStatus(from)) {
    return to === "IN_LAVORAZIONE" || to === "COMPLETATO" || to === "KO";
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
}): string[] {
  const errors: string[] = [];
  if (!canTransitionMasterStatus(opts.from, opts.to, opts.allowAdminOverride)) {
    errors.push(
      `Transizione non consentita: ${opts.from} → ${opts.to}. Flusso: In lavorazione → Completato oppure KO.`,
    );
  }
  if (opts.to === "KO") {
    if (!opts.koReason?.trim()) errors.push("Motivo del KO obbligatorio");
    if (opts.koReason === "ALTRO" && !opts.koOtherText?.trim()) {
      errors.push("Specifica il motivo KO (Altro)");
    }
    if (!opts.koNotes?.trim()) errors.push("Note sul KO obbligatorie");
  }
  // COMPLETATO: dati economici in Provvigioni (non obbligatori qui)
  return errors;
}

export function daysSince(date: Date | string | null | undefined): number | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  const ms = Date.now() - d.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

export function masterAwareStatusLabel(
  status: AppContractStatus | string,
  labels: Record<string, string>,
): string {
  if (status === "KO") return "KO";
  if (status === "IN_LAVORAZIONE") return "In lavorazione";
  if (status === "COMPLETATO") return "Completato";
  if (status === "IN_ATTESA_PAGAMENTO") return "In attesa di pagamento (archiviato)";
  if (status === "ATTIVATO") return "Attivato (archiviato)";
  return labels[status] ?? status;
}
