/**
 * Tipi condivisi con i componenti client. Nessun import lato server, così il
 * bundle del browser non trascina Prisma né i moduli `server-only`.
 */

export type PayoutPreviewRowStatus =
  | "will_apply"
  | "already_applied"
  | "ambiguous"
  | "unmatched"
  | "no_amount";

export const PAYOUT_PREVIEW_STATUS_LABEL: Record<
  PayoutPreviewRowStatus,
  string
> = {
  will_apply: "Da applicare",
  already_applied: "Già registrato",
  ambiguous: "Da confermare",
  unmatched: "Contratto non trovato",
  no_amount: "Importo assente",
};

export type PayoutPreviewRow = {
  sheetName: string;
  rowIndex: number;
  podRaw: string;
  clientNameRaw: string;
  amount: number | null;
  period: string | null;
  status: PayoutPreviewRowStatus;
  matchReason?: string;
  matchScore?: number;
  contractNumber?: string;
  crmClientName?: string;
  supplierName?: string;
  collaboratorName?: string;
  candidateCount?: number;
  /** Motivo per cui la riga non viene applicata */
  skipReason?: string;
};

export type PayoutPreviewCollaboratorTotal = {
  collaboratorName: string;
  rowCount: number;
  total: number;
};

export type PayoutPreviewResult = {
  ok: true;
  fileName: string;
  templateKey: string;
  templateLabel: string;
  sheetsRead: string[];
  settledPeriod: string;
  /** Competenza usata dalle righe che non la portano */
  fallbackPeriod: string;
  rows: PayoutPreviewRow[];
  summary: {
    total: number;
    willApply: number;
    alreadyApplied: number;
    ambiguous: number;
    unmatched: number;
    noAmount: number;
  };
  /** Quadratura: totale letto dal file vs totale dichiarato dalla fonte */
  computedTotal: number;
  declaredTotal: number | null;
  /** Totale delle sole righe che verranno applicate */
  applicableTotal: number;
  byCollaborator: PayoutPreviewCollaboratorTotal[];
  skippedRows: Array<{ sheetName: string; rowIndex: number; reason: string }>;
  /** Righe visualizzate: l'anteprima è troncata sui file molto grandi */
  truncated: boolean;
};

export type PayoutActionError = { ok: false; error: string; details?: string[] };

export type PayoutBatchProgress = {
  ok: true;
  /** Righe elaborate in questa chiamata */
  processed: number;
  /** Righe ancora da elaborare: l'interfaccia richiama finché non è 0 */
  remaining: number;
  applied: number;
  skipped: number;
  errors: number;
};
