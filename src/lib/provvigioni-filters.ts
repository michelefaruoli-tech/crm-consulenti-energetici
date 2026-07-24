/**
 * Filtri condivisi Provvigioni (pagina + export Excel).
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
    isHistorical: false as const,
    deletedAt: null,
    ...(collaboratorId ? { collaboratorId } : {}),
  };
}
