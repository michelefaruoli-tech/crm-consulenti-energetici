/**
 * Filtri condivisi Provvigioni (pagina + export Excel).
 * Include anche i contratti da archivio storico (isHistorical),
 * così i database importati compaiono filtrando per collaboratore.
 */
export type ProvvigioniFilters = {
  canViewAll: boolean;
  sessionUserId: string;
  /** ID collaboratore da query ?collab= */
  collab?: string | null;
};

export function buildProvvigioniContractWhere(f: ProvvigioniFilters) {
  const collabFilter =
    f.canViewAll && f.collab && f.collab !== "tutti" ? f.collab : undefined;
  const collaboratorId = f.canViewAll ? collabFilter : f.sessionUserId;

  return {
    deletedAt: null,
    ...(collaboratorId ? { collaboratorId } : {}),
  };
}
