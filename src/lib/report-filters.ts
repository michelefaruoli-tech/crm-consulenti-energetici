/**
 * Filtri condivisi Report (pagina + export Excel/PDF).
 *
 * Regola: il mese del Report = mese della colonna «Incasso» in Provvigioni
 * (`collectionDate`), per TUTTI i fornitori.
 * Esempio: Incasso 06/2026 → scegli Giugno 2026 nel Report.
 *
 * Eccezione: «Da incassare» / «KO» (senza data incasso) → data inserimento.
 */
import type { Prisma } from "@/generated/prisma/client";
import { fromZonedTime } from "date-fns-tz";
import { PROVVIGIONE_STATO_OPTIONS } from "@/lib/provvigioni-stato";
import { provvigioneStatoWhere } from "@/lib/provvigioni-filters";
import { resolveReportPeriod } from "@/lib/report-month";
import { APP_TZ } from "@/lib/timezone";

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

/**
 * Intervallo date in Europe/Rome (allineato alla colonna Incasso MM/AAAA).
 * Evita che su Vercel (UTC) un 01/06 Roma finisca fuori dal mese.
 */
export function reportDateRange(from?: string | null, to?: string | null) {
  if (from && to) {
    const dateFrom = fromZonedTime(`${from}T00:00:00.000`, APP_TZ);
    const dateTo = fromZonedTime(`${to}T23:59:59.999`, APP_TZ);
    return { dateFrom, dateTo };
  }
  if (from) {
    const dateFrom = fromZonedTime(`${from}T00:00:00.000`, APP_TZ);
    return { dateFrom, dateTo: new Date() };
  }
  const y = new Date().getFullYear();
  return {
    dateFrom: fromZonedTime(`${y}-01-01T00:00:00.000`, APP_TZ),
    dateTo: new Date(),
  };
}

/**
 * Incassato / Pagato / Tutti → periodo = data incasso (colonna Provvigioni).
 * Da incassare / KO → data inserimento (non hanno incasso).
 */
export function reportPeriodUsesCollectionDate(stato: string): boolean {
  return stato === "Incassato" || stato === "Pagato" || stato === "Tutti";
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
      return "Periodo = colonna Incasso (MM/AAAA) in Provvigioni, tutti i fornitori. Es. Giugno = Incasso 06/2026.";
    case "Pagato":
      return "Periodo = data di incasso (stesso mese della colonna Incasso). Già liquidati ai collaboratori.";
    case "KO / Cessato":
      return "Periodo = data inserimento. Pratiche KO / annullate / chiuse.";
    default:
      return "Periodo = data di incasso (colonna Incasso). Include tutti gli stati con incasso in quel mese.";
  }
}
