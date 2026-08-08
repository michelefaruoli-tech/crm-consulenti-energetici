/**
 * Filtri condivisi Report (pagina + export Excel/PDF).
 *
 * Regola: il mese del Report = mese della colonna «Incasso» in Provvigioni
 * (`collectionDate`), per TUTTI i fornitori.
 * Esempio: Incasso 06/2026 → scegli Giugno 2026 nel Report.
 *
 * Eccezione: «Da incassare» / «KO» (senza data incasso) → data inserimento.
 * Multi-selezione: valori separati da `|` (es. Incassato|Pagato).
 */
import type { Prisma } from "@/generated/prisma/client";
import { fromZonedTime } from "date-fns-tz";
import { PROVVIGIONE_STATO_OPTIONS } from "@/lib/provvigioni-stato";
import {
  parseFilterList,
  formatFilterList,
  provvigioneStatoWhere,
} from "@/lib/provvigioni-filters";
import {
  resolveReportPeriod,
  monthToDateRange,
} from "@/lib/report-month";
import { APP_TZ } from "@/lib/timezone";

export type ReportFilterParams = {
  from?: string | null;
  to?: string | null;
  /** Uno o più mesi YYYY-MM separati da `|` (ha priorità su from/to) */
  month?: string | null;
  /** Uno o più ID collaboratore (separati da |) */
  collaboratorId?: string | null;
  /** Uno o più ID fornitore (separati da |) */
  supplierId?: string | null;
  /** Uno o più stati (separati da |) oppure Tutti */
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
  formatMonthsLabel,
  parseMonthList,
  recentMonthOptions,
  currentMonthValue,
  resolveReportPeriod,
} from "@/lib/report-month";

export { parseFilterList, formatFilterList };

/** Lista stati validi dal query param (senza «Tutti» se ci sono altri). */
export function resolveReportStati(raw: string | null | undefined): string[] {
  const parts = parseFilterList(raw);
  if (parts.length === 0) return [REPORT_DEFAULT_STATO];
  const valid = parts.filter(
    (s) => (REPORT_STATO_OPTIONS as readonly string[]).includes(s),
  );
  if (valid.length === 0) return [REPORT_DEFAULT_STATO];
  if (valid.includes("Tutti")) return ["Tutti"];
  return valid;
}

/** Compat: primo stato o stringa unita con | */
export function resolveReportStato(raw: string | null | undefined): string {
  const stati = resolveReportStati(raw);
  return formatFilterList(stati) ?? REPORT_DEFAULT_STATO;
}

export function reportHasStato(
  stati: string[] | string,
  needle: string,
): boolean {
  const list = Array.isArray(stati) ? stati : resolveReportStati(stati);
  if (list.includes("Tutti")) {
    return ["Incassato", "Pagato", "Stornato", "Tutti"].includes(needle);
  }
  return list.includes(needle);
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
 * Stornato → periodo = data storno (mese del clawback).
 * Da incassare / KO → data inserimento (non hanno incasso).
 */
export function reportPeriodUsesCollectionDate(stato: string): boolean {
  const stati = resolveReportStati(stato);
  return stati.some(
    (s) => s === "Incassato" || s === "Pagato" || s === "Tutti",
  );
}

export function reportPeriodUsesStornoDate(stato: string): boolean {
  const stati = resolveReportStati(stato);
  // Solo se TUTTI gli stati selezionati sono Stornato (altrimenti mix con OR)
  return stati.length > 0 && stati.every((s) => s === "Stornato");
}

function dateWhereForStato(
  stato: string,
  dateFrom: Date,
  dateTo: Date,
): Prisma.ContractWhereInput {
  if (stato === "Stornato") {
    return { commission: { stornoDate: { gte: dateFrom, lte: dateTo } } };
  }
  if (
    stato === "Incassato" ||
    stato === "Pagato" ||
    stato === "Tutti"
  ) {
    return { collectionDate: { gte: dateFrom, lte: dateTo } };
  }
  // Da incassare / Da controllare / KO
  return { insertionDate: { gte: dateFrom, lte: dateTo } };
}

/** Unione di mesi (anche non contigui: Maggio + Agosto senza Giugno). */
function dateWhereForStatoPeriod(
  stato: string,
  months: string[],
  fallbackFrom: Date,
  fallbackTo: Date,
): Prisma.ContractWhereInput {
  if (months.length <= 1) {
    if (months.length === 1) {
      const r = monthToDateRange(months[0]!);
      if (r) {
        const { dateFrom, dateTo } = reportDateRange(r.from, r.to);
        return dateWhereForStato(stato, dateFrom, dateTo);
      }
    }
    return dateWhereForStato(stato, fallbackFrom, fallbackTo);
  }
  return {
    OR: months.map((m) => {
      const r = monthToDateRange(m)!;
      const { dateFrom, dateTo } = reportDateRange(r.from, r.to);
      return dateWhereForStato(stato, dateFrom, dateTo);
    }),
  };
}

export function buildReportContractWhere(
  params: ReportFilterParams,
  visibility: Prisma.ContractWhereInput,
): Prisma.ContractWhereInput {
  const period = resolveReportPeriod(params);
  const { dateFrom, dateTo } = reportDateRange(period.from, period.to);
  const stati = resolveReportStati(params.stato);
  const months = period.months;

  const and: Prisma.ContractWhereInput[] = [
    visibility,
    { deletedAt: null },
    { isHistorical: false },
  ];

  if (stati.includes("Tutti")) {
    and.push(dateWhereForStatoPeriod("Tutti", months, dateFrom, dateTo));
  } else if (stati.length === 1) {
    const s = stati[0]!;
    and.push(dateWhereForStatoPeriod(s, months, dateFrom, dateTo));
    const statoWhere = provvigioneStatoWhere(s);
    if (statoWhere) and.push(statoWhere);
  } else {
    // Multi-stato: ogni stato con la sua data di periodo
    const ors: Prisma.ContractWhereInput[] = [];
    for (const s of stati) {
      const statoWhere = provvigioneStatoWhere(s);
      ors.push({
        AND: [
          dateWhereForStatoPeriod(s, months, dateFrom, dateTo),
          ...(statoWhere ? [statoWhere] : []),
        ],
      });
    }
    and.push({ OR: ors });
  }

  const collabIds = parseFilterList(params.collaboratorId);
  if (collabIds.length === 1) {
    and.push({ collaboratorId: collabIds[0] });
  } else if (collabIds.length > 1) {
    and.push({ collaboratorId: { in: collabIds } });
  }

  const supplierIds = parseFilterList(params.supplierId);
  if (supplierIds.length === 1) {
    and.push({ supplierId: supplierIds[0] });
  } else if (supplierIds.length > 1) {
    and.push({ supplierId: { in: supplierIds } });
  }

  return { AND: and };
}

export function reportStatoHint(stato: string): string {
  const stati = resolveReportStati(stato);
  if (stati.length > 1) {
    return `Multi-selezione: ${stati.join(" + ")}. Il periodo usa la data corretta per ogni stato (incasso / storno / inserimento).`;
  }
  switch (stati[0]) {
    case "Da controllare":
      return "Periodo = data inserimento. Contratti inseriti ma non ancora contrattualizzati.";
    case "Da incassare":
      return "Periodo = data inserimento. Contratti ancora da pagare dal fornitore.";
    case "Incassato":
      return "Periodo = colonna Incasso (MM/AAAA) in Provvigioni. Include anche gli storni del mese (importi negativi).";
    case "Pagato":
      return "Periodo = data di incasso (stesso mese della colonna Incasso). Già liquidati ai collaboratori.";
    case "Stornato":
      return "Periodo = data storno (MM/AAAA). Storni applicati: importo negativo che detrae dalle provvigioni.";
    case "KO / Cessato":
      return "Periodo = data inserimento. Pratiche KO / annullate / chiuse.";
    default:
      return "Periodo = data di incasso (colonna Incasso). Include tutti gli stati con incasso in quel mese.";
  }
}
