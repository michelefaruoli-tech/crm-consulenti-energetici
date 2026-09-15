/**
 * Costruzione unica della query Provvigioni.
 *
 * Pagina, export Excel e menu dei filtri devono guardare esattamente lo stesso
 * insieme di righe: qui vivono la lettura dei parametri URL, lo scope per ruolo
 * e la traduzione dei filtri di colonna in `where` Prisma.
 */
import "server-only";
import type { Prisma, Role } from "@/generated/prisma/client";
import { hasPermission } from "@/lib/permissions";
import { contractVisibilityWhere } from "@/lib/user-scope";
import {
  buildProvvigioniListWhere,
  parseProvvigioniFocus,
  type ProvvigioniListFocus,
} from "@/lib/provvigioni-filters";
import {
  parseProvvigioniVista,
  vistaToRecurrenceMode,
  type ProvvigioniVista,
} from "@/lib/provvigioni-competence";
import { prisma } from "@/lib/prisma";
import {
  buildColumnFilterWhere,
  parseProvvigioniColumnFilters,
  type ColumnFilterWhere,
  type ProvvigioniColumnFilters,
  type ProvvigioniColumnKey,
  type ProvvigioniFilterContext,
} from "@/lib/provvigioni-column-filters";
import {
  getRecurringExpandMode,
  type ProvvigioniRowFilterScope,
  type RecurringExpandMode,
} from "@/lib/provvigioni-rows";
import { addMonths, toPeriod } from "@/lib/recurring";

/**
 * Dati letti una volta per tradurre le colonne derivate (agenzia dal fornitore,
 * gettone di listino, etichette tipo operazione): poche righe, nessun N+1.
 */
export async function loadProvvigioniFilterContext(): Promise<ProvvigioniFilterContext> {
  const [suppliers, operations] = await Promise.all([
    prisma.supplier.findMany({ select: { id: true, name: true } }),
    prisma.contract.findMany({
      where: { deletedAt: null },
      select: { operationType: true },
      distinct: ["operationType"],
      take: 200,
    }),
  ]);
  return {
    suppliers,
    operationTypes: operations.map((o) => o.operationType),
  };
}


export type ProvvigioniSearchParams = Record<
  string,
  string | string[] | undefined
>;

export type ProvvigioniQuerySession = { id: string; role: Role };

export type ResolvedProvvigioniQuery = {
  canViewAll: boolean;
  isScoped: boolean;
  collabFilter?: string;
  supplier?: string;
  stato?: string;
  tipologia?: string;
  q?: string;
  vista: ProvvigioniVista;
  focus?: ProvvigioniListFocus;
  settledPeriod: string;
  effectiveCompetence?: string;
  applyCompetenceToList: boolean;
  viewingAllPeriods: boolean;
  expandMode: RecurringExpandMode | null;
  visibility: Prisma.ContractWhereInput;
  columnFilters: ProvvigioniColumnFilters;
  columnWhereParts: ColumnFilterWhere;
  rowScope: ProvvigioniRowFilterScope;
  contractWhere: Prisma.ContractWhereInput;
};

function readParam(
  sp: ProvvigioniSearchParams,
  name: string,
): string | undefined {
  const raw = sp[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * @param opts.skipColumn colonna da ignorare: serve ai menu dei filtri, dove le
 * opzioni di una colonna si calcolano con gli altri filtri attivi (come in Excel).
 * @param opts.flatten tutti i filtri nel `where` del contratto, anche quelli che
 * nella lista valgono sulla singola rata. Serve all'export Excel, che ha una riga
 * per contratto: «mese rif. agosto» diventa «il contratto ha una rata di agosto».
 */
export async function resolveProvvigioniQuery(
  session: ProvvigioniQuerySession,
  sp: ProvvigioniSearchParams,
  opts?: { skipColumn?: ProvvigioniColumnKey; flatten?: boolean },
): Promise<ResolvedProvvigioniQuery> {
  const canViewAll = hasPermission(session.role, "commissions.view_all");
  const isScoped = hasPermission(session.role, "contracts.work_scoped");

  const collabRaw = readParam(sp, "collab");
  const collabFilter =
    (canViewAll || isScoped) && collabRaw && collabRaw !== "tutti"
      ? collabRaw
      : undefined;
  const supplier = readParam(sp, "supplier");
  const stato = readParam(sp, "stato");
  const tipologia = readParam(sp, "tipologia");
  const q = readParam(sp, "q");
  const vista = parseProvvigioniVista(readParam(sp, "vista"));
  const focus = parseProvvigioniFocus(readParam(sp, "focus"));
  const recurrenceMode = vistaToRecurrenceMode(vista);

  const settledRaw = readParam(sp, "settled");
  const settledPeriod =
    settledRaw && /^\d{4}-\d{2}$/.test(settledRaw)
      ? settledRaw
      : toPeriod(new Date());

  const competenceRaw = readParam(sp, "competence");
  const showCompetencePanel = vista === "mensile" || vista === "annuale";
  const competenceAll =
    competenceRaw === "tutti" || (!competenceRaw && showCompetencePanel);
  const competencePeriod =
    competenceRaw && competenceRaw !== "tutti" && /^\d{4}-\d{2}$/.test(competenceRaw)
      ? competenceRaw
      : undefined;
  const effectiveCompetence = competenceAll ? undefined : competencePeriod;
  const applyCompetenceToList = Boolean(effectiveCompetence);
  const viewingAllPeriods =
    competenceAll || (!competencePeriod && !showCompetencePanel);

  const expandMode = getRecurringExpandMode(
    stato,
    viewingAllPeriods,
    effectiveCompetence,
  );

  const [visibility, filterContext] = await Promise.all([
    contractVisibilityWhere(session),
    loadProvvigioniFilterContext(),
  ]);

  const parsedColumns = parseProvvigioniColumnFilters(sp);
  const columnFilters: ProvvigioniColumnFilters = { ...parsedColumns };
  if (opts?.skipColumn) delete columnFilters[opts.skipColumn];

  const columnWhereParts = buildColumnFilterWhere(columnFilters, filterContext, {
    expanded: opts?.flatten ? false : Boolean(expandMode),
  });
  const rowScope: ProvvigioniRowFilterScope = {
    unitOnly: columnWhereParts.unitOnly,
    rate: columnWhereParts.rate,
    excludeUnitRows: columnWhereParts.excludeUnitRows,
  };

  const contractWhere = buildProvvigioniListWhere({
    filters: {
      canViewAll: canViewAll || isScoped,
      sessionUserId: session.id,
      collab: collabFilter,
      supplier,
      stato,
      tipologia,
      q,
      recurrenceMode,
      visibility,
      columnWhere: columnWhereParts.contract,
      competencePeriod: effectiveCompetence,
    },
    focus,
    effectiveCompetence,
    applyCompetenceToList,
  });

  return {
    canViewAll,
    isScoped,
    collabFilter,
    supplier,
    stato,
    tipologia,
    q,
    vista,
    focus,
    settledPeriod,
    effectiveCompetence,
    applyCompetenceToList,
    viewingAllPeriods,
    expandMode,
    visibility,
    columnFilters: parsedColumns,
    columnWhereParts,
    rowScope,
    contractWhere,
  };
}

/** Mese di riconciliazione usato dalle viste ricorrenti (mese precedente al rendiconto). */
export function reconciliationPeriodFor(settledPeriod: string): string {
  return addMonths(settledPeriod, -1);
}
