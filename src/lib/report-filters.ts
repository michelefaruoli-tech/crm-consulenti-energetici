/**
 * Filtri condivisi Report (pagina + export Excel/PDF).
 */
import type { Prisma } from "@/generated/prisma/client";
import { PROVVIGIONE_STATO_OPTIONS } from "@/lib/provvigioni-stato";
import { provvigioneStatoWhere } from "@/lib/provvigioni-filters";

export type ReportFilterParams = {
  from?: string | null;
  to?: string | null;
  collaboratorId?: string | null;
  supplierId?: string | null;
  /** Da incassare | Incassato | Pagato | KO / Cessato | Tutti */
  stato?: string | null;
};

/** Default: solo contratti già incassati dal fornitore (da liquidare ai collab). */
export const REPORT_DEFAULT_STATO = "Incassato";

export const REPORT_STATO_OPTIONS = [
  "Tutti",
  ...PROVVIGIONE_STATO_OPTIONS,
] as const;

export function resolveReportStato(raw: string | null | undefined): string {
  const s = raw?.trim();
  if (!s) return REPORT_DEFAULT_STATO;
  if ((REPORT_STATO_OPTIONS as readonly string[]).includes(s)) return s;
  return REPORT_DEFAULT_STATO;
}

export function reportDateRange(from?: string | null, to?: string | null) {
  const dateFrom = from
    ? new Date(`${from}T00:00:00.000`)
    : new Date(new Date().getFullYear(), 0, 1);
  const dateTo = to ? new Date(`${to}T23:59:59.999`) : new Date();
  return { dateFrom, dateTo };
}

export function buildReportContractWhere(
  params: ReportFilterParams,
  visibility: Prisma.ContractWhereInput,
): Prisma.ContractWhereInput {
  const { dateFrom, dateTo } = reportDateRange(params.from, params.to);
  const stato = resolveReportStato(params.stato);
  const statoWhere = provvigioneStatoWhere(stato === "Tutti" ? undefined : stato);

  const and: Prisma.ContractWhereInput[] = [
    visibility,
    { deletedAt: null },
    { insertionDate: { gte: dateFrom, lte: dateTo } },
  ];

  if (params.collaboratorId) {
    and.push({ collaboratorId: params.collaboratorId });
  }
  if (params.supplierId) {
    and.push({ supplierId: params.supplierId });
  }
  if (statoWhere) and.push(statoWhere);

  return { AND: and };
}

export function reportStatoHint(stato: string): string {
  switch (stato) {
    case "Da incassare":
      return "Contratti inseriti: il fornitore non ha ancora pagato a te.";
    case "Incassato":
      return "Il fornitore ha pagato a te: questi importi restano da liquidare ai collaboratori.";
    case "Pagato":
      return "Hai già pagato i collaboratori (provvigione liquidata).";
    case "KO / Cessato":
      return "Pratiche KO / annullate / chiuse senza incasso.";
    default:
      return "Tutti gli stati (da incassare, incassato, pagato, KO).";
  }
}
