/**
 * Filtri condivisi Report (pagina + export Excel/PDF).
 *
 * Importante — quale data usa il periodo:
 * - Incassato / Pagato → `collectionDate` (quando il fornitore ha pagato)
 * - Da incassare / KO / Tutti → `insertionDate` (quando è entrato in CRM)
 *
 * Prima il Report filtrava SEMPRE su insertionDate: così un contratto inserito
 * a maggio e incassato a luglio spariva dal report di luglio (ma restava
 * in Provvigioni → Incassato).
 */
import type { Prisma } from "@/generated/prisma/client";
import { PROVVIGIONE_STATO_OPTIONS } from "@/lib/provvigioni-stato";
import { provvigioneStatoWhere } from "@/lib/provvigioni-filters";
import { resolveReportPeriod } from "@/lib/report-month";

export type ReportFilterParams = {
  from?: string | null;
  to?: string | null;
  /** Mese intero YYYY-MM (ha priorità su from/to se valorizzato) */
  month?: string | null;
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

export {
  REPORT_MONTH_LABELS,
  monthToDateRange,
  formatMonthLabel,
  recentMonthOptions,
  currentMonthValue,
  resolveReportPeriod,
} from "@/lib/report-month";

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

/**
 * Per Incassato/Pagato il periodo deve seguire la data di incasso,
 * altrimenti i totali non combaciano con Provvigioni.
 */
export function reportPeriodUsesCollectionDate(stato: string): boolean {
  return stato === "Incassato" || stato === "Pagato";
}

export function buildReportContractWhere(
  params: ReportFilterParams,
  visibility: Prisma.ContractWhereInput,
): Prisma.ContractWhereInput {
  const period = resolveReportPeriod(params);
  const { dateFrom, dateTo } = reportDateRange(period.from, period.to);
  const stato = resolveReportStato(params.stato);
  const statoWhere = provvigioneStatoWhere(stato === "Tutti" ? undefined : stato);
  const useCollection = reportPeriodUsesCollectionDate(stato);

  const and: Prisma.ContractWhereInput[] = [
    visibility,
    { deletedAt: null },
    { isHistorical: false },
    useCollection
      ? { collectionDate: { gte: dateFrom, lte: dateTo } }
      : { insertionDate: { gte: dateFrom, lte: dateTo } },
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
      return "Periodo = data inserimento. Contratti ancora da pagare dal fornitore.";
    case "Incassato":
      return "Periodo = data di incasso (come in Provvigioni). Fornitore ha pagato: importi da liquidare ai collaboratori.";
    case "Pagato":
      return "Periodo = data di incasso. Hai già liquidato i collaboratori.";
    case "KO / Cessato":
      return "Periodo = data inserimento. Pratiche KO / annullate / chiuse.";
    default:
      return "Periodo = data inserimento. Tutti gli stati.";
  }
}
