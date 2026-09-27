/**
 * Tipi e costanti condivisi (client-safe) per la bonifica Helios anticipate.
 * Nessun import Prisma / server-only.
 */

export const HELIOS_ANTICIPATORY_SCAN_BATCH = 200;
export const HELIOS_ANTICIPATORY_APPLY_BATCH = 80;
export const HELIOS_ANTICIPATORY_AUTO_MAX_BATCHES = 8;

export type HeliosAnticipatoryAction = "delete" | "close";

export type HeliosAnticipatoryRow = {
  id: string;
  contractId: string;
  contractLabel: string;
  collaboratorName: string;
  period: string;
  periodLabel: string;
  status: string;
  amount: number | null;
  settledPeriod: string | null;
  /** delete = senza valore economico; close = PAID/LIQUIDATED/ERROR o con paidAt */
  suggestedAction: HeliosAnticipatoryAction;
};
