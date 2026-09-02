/**
 * Ripristino contratti chiusi/archiviati per errore verso Provvigioni attive.
 * Evita che il job POD-supersede li rimetta subito in KO.
 */

export const MANUAL_RESTORE_ARCHIVE_LABEL = "ripristinato-manuale";

export function isManuallyRestoredArchiveLabel(
  archiveLabel: string | null | undefined,
): boolean {
  return (archiveLabel ?? "").trim().toLowerCase() === MANUAL_RESTORE_ARCHIVE_LABEL;
}

/** Campi da applicare quando si esce da KO/CHIUSO/ANNULLATO o da Archivio. */
export function reactivateContractFields(opts?: {
  /** Se true, azzera anche i note KO (default true). */
  clearKo?: boolean;
}) {
  const clearKo = opts?.clearKo !== false;
  return {
    isHistorical: false as const,
    archiveLabel: MANUAL_RESTORE_ARCHIVE_LABEL,
    ...(clearKo
      ? {
          koReason: null as string | null,
          koNotes: null as string | null,
        }
      : {}),
  };
}
