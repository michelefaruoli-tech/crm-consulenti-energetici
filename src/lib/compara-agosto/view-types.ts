/**
 * Tipi client-safe per l'anteprima Compara Agosto.
 * Nessun import server-only: usati dal pannello React.
 */

export type ComparaAgostoAction =
  | "update"
  | "create"
  | "confirm"
  | "unmatched"
  | "skip_liquidated";

export type ComparaPodFillMode =
  | "none"
  | "safe_prefill"
  | "needs_confirm"
  | "display_from_crm";

export const COMPARA_AGOSTO_ACTION_LABEL: Record<ComparaAgostoAction, string> = {
  update: "Da aggiornare (Incassato da liquidare)",
  create: "Da creare (manca in Provvigioni)",
  confirm: "Da confermare (Michele)",
  unmatched: "Senza corrispondenza",
  skip_liquidated: "Già liquidata — non sovrascrivere",
};

export function comparaAgostoRowKey(row: {
  sheetName: string;
  rowIndex: number;
}): string {
  return `${row.sheetName}:${row.rowIndex}`;
}

/** Override editabili in UI prima dell'apply (chiave = sheet:rowIndex). */
export type ComparaAgostoRowEdit = {
  amount: number | null;
  collaboratorId: string;
  collaboratorName: string;
  /** Etichetta liquidazione (run) per questa riga. */
  rowLabel: string;
  /** POD proposto in scrittura (editabile). */
  proposedPodFill: string;
};

export type ComparaAgostoCollaboratorOption = {
  id: string;
  name: string;
};

export type ComparaAgostoPreviewRow = {
  sheetName: string;
  rowIndex: number;
  nominativo: string;
  supplierHint: string;
  shopHint: string;
  podRaw: string;
  fileAmount: number | null;
  ruleAmount: number | null;
  ruleApplied: boolean;
  units: number;
  period: string | null;
  action: ComparaAgostoAction;
  matchReason?: string;
  matchScore?: number;
  contractId?: string;
  contractNumber?: string;
  crmClientName?: string;
  crmPod?: string;
  supplierName?: string;
  collaboratorName?: string;
  /** Id collaboratore CRM se matchato (per prefill tendina). */
  collaboratorId?: string;
  isFagiano: boolean;
  fagianoMissingPodInFile: boolean;
  podFillMode: ComparaPodFillMode;
  /** POD proposto in scrittura sul contratto (se approvato). */
  proposedPodFill?: string;
  skipReason?: string;
  /** Importo già liquidato presente in CRM (avviso). */
  existingLiquidatedAmount?: number | null;
  /** Etichetta liquidazione di default per la riga. */
  defaultRowLabel?: string;
};

export type ComparaAgostoPreviewResult = {
  ok: true;
  fileName: string;
  competencePeriod: string;
  settledPeriod: string;
  defaultRunLabel: string;
  sheetsRead: string[];
  rows: ComparaAgostoPreviewRow[];
  collaborators: ComparaAgostoCollaboratorOption[];
  summary: {
    total: number;
    update: number;
    create: number;
    confirm: number;
    unmatched: number;
    skipLiquidated: number;
    fagianoRows: number;
    fagianoMissingPod: number;
    fagianoProbableMatch: number;
    fagianoPodPrefill: number;
    fagianoPodConfirm: number;
    ruleAmountTotal: number;
  };
  truncated: boolean;
};

export type ComparaAgostoActionError = {
  ok: false;
  error: string;
  details?: string[];
};
