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

/** Chiave stabile di una riga in anteprima (sheet + indice Excel). */
export function payoutPreviewRowKey(row: {
  sheetName: string;
  rowIndex: number;
}): string {
  return `${row.sheetName}:${row.rowIndex}`;
}

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

export type BulkHistoricalExclusionMode = "TOTAL" | "ACTIVE_ONLY";
export type BulkHistoricalMarkMode = "INCASSATO" | "LIQUIDATO";

export const BULK_HISTORICAL_PERIOD_LIMIT = "2026-06";

export type BulkHistoricalPreviewResult = {
  ok: true;
  supplierName: string;
  periodLimit: string;
  markMode: BulkHistoricalMarkMode;
  exclusionMode: BulkHistoricalExclusionMode;
  excludedCollaboratorPatterns: string[];
  runLabel: string;
  signature: string;
  summary: {
    contractCount: number;
    rateCount: number;
    totalAmount: number;
    outsideWindowCount: number;
    skippedCount: number;
  };
  byCollaborator: Array<{
    collaboratorName: string;
    contractCount: number;
    rateCount: number;
    total: number;
  }>;
  byMonth: Array<{
    period: string;
    rateCount: number;
    total: number;
  }>;
  skippedByReason: Array<{
    reason: string;
    label: string;
    count: number;
  }>;
  /** Campione di rate da applicare (anteprima troncata su dataset grandi) */
  sampleRows: Array<{
    contractNumber: string;
    clientName: string;
    collaboratorName: string;
    period: string;
    amount: number | null;
    outsideSupplyWindow: boolean;
  }>;
  /** Campione di casi saltati */
  sampleSkipped: Array<{
    contractNumber: string;
    collaboratorName: string;
    period: string;
    reason: string;
    detail?: string;
  }>;
  truncated: boolean;
};
