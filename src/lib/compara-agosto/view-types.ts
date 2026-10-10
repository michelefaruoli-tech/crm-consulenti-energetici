/**
 * Tipi client-safe per l'elenco Compara Agosto (edit + salva).
 * Nessun import server-only: usati dal pannello React.
 */

/** Compatibilità apply interno (non mostrato come «azione» UI). */
export type ComparaAgostoAction =
  | "update"
  | "create"
  | "confirm"
  | "unmatched"
  | "skip_liquidated"
  | "already_ok";

/**
 * Situazione verso Provvigioni:
 * - present: contratto con fornitore compatibile → Salva aggiorna
 * - needs_create: assente o Liquidata altro fornitore → conferma + collaboratore
 */
export type ComparaPresence = "present" | "needs_create";

/** @deprecated tenuto per check script / compat */
export type ComparaSuggestion =
  | "already_ok"
  | "update_status"
  | "insert_pod"
  | "create_row"
  | "confirm_match"
  | "skip_liquidated";

export type ComparaPodFillMode =
  | "none"
  | "safe_prefill"
  | "needs_confirm"
  | "display_from_crm";

export const COMPARA_PRESENCE_LABEL: Record<ComparaPresence, string> = {
  present: "In Provvigioni",
  needs_create: "Da caricare",
};

/** @deprecated */
export const COMPARA_SUGGESTION_LABEL: Record<ComparaSuggestion, string> = {
  already_ok: "Già in liquidazione",
  update_status: "Da aggiornare",
  insert_pod: "Inserisci POD dal file",
  create_row: "Crea riga",
  confirm_match: "Da confermare",
  skip_liquidated: "Già liquidata",
};

/** @deprecated */
export const COMPARA_AGOSTO_ACTION_LABEL: Record<ComparaAgostoAction, string> = {
  update: "Da aggiornare",
  create: "Crea riga",
  confirm: "Da confermare",
  unmatched: "Crea riga",
  skip_liquidated: "Già liquidata",
  already_ok: "Già in liquidazione",
};

export function comparaAgostoRowKey(row: {
  sheetName: string;
  rowIndex: number;
}): string {
  return `${row.sheetName}:${row.rowIndex}`;
}

/** @deprecated */
export function comparaSuggestionForRow(row: {
  action: ComparaAgostoAction;
  podNeedsFill?: boolean;
}): ComparaSuggestion {
  if (row.action === "already_ok") return "already_ok";
  if (row.action === "skip_liquidated") return "skip_liquidated";
  if (row.action === "unmatched" || row.action === "create") return "create_row";
  if (row.action === "confirm") return "confirm_match";
  if (row.action === "update" && row.podNeedsFill) return "insert_pod";
  return "update_status";
}

/** Override editabili in UI prima del salvataggio. */
export type ComparaAgostoRowEdit = {
  nominativo: string;
  supplier: string;
  amount: number | null;
  pod: string;
  stato: string;
  collaboratorId: string;
  collaboratorName: string;
  rowLabel: string;
  /** Solo needs_create: Michele conferma di caricare la riga. */
  createConfirmed?: boolean;
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
  /** Interno apply. */
  action: ComparaAgostoAction;
  /** Situazione UI. */
  presence: ComparaPresence;
  presenceNote?: string;
  /** @deprecated */
  suggestion: ComparaSuggestion;
  suggestionLabel?: string;
  matchReason?: string;
  matchScore?: number;
  contractId?: string;
  contractNumber?: string;
  crmClientName?: string;
  crmPod?: string;
  supplierName?: string;
  collaboratorName?: string;
  collaboratorId?: string;
  crmStato?: string;
  proposedStato: string;
  isFagiano: boolean;
  fagianoMissingPodInFile: boolean;
  podNeedsFill: boolean;
  podFillMode: ComparaPodFillMode;
  proposedPodFill?: string;
  skipReason?: string;
  existingLiquidatedAmount?: number | null;
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
    present: number;
    needsCreate: number;
    /** legacy counts for check scripts */
    update: number;
    create: number;
    confirm: number;
    unmatched: number;
    skipLiquidated: number;
    alreadyOk: number;
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
