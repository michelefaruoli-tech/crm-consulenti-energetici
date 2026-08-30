import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { canConfirmCommission, hasPermission } from "@/lib/permissions";
import { formatMonthYear } from "@/lib/date-parse";
import { clientDisplayName, clientSortKey } from "@/lib/utils";
import { ROLE_LABELS, type AppRole } from "@/lib/constants";
import {
  ProvvigioniFilterTable,
} from "@/components/provvigioni/provvigioni-filter-table";
import { ProvvigioniTrashPanel } from "@/components/provvigioni/provvigioni-trash-panel";
import { RecurringMissingPanel } from "@/components/provvigioni/recurring-missing-panel";
import { HeliosAbsentPanel } from "@/components/provvigioni/helios-absent-panel";
import { ProvvigioniVistaTabs } from "@/components/provvigioni/provvigioni-vista-tabs";
import { ProvvigioniToolbar } from "@/components/provvigioni/provvigioni-toolbar";
import { ProvvigioniSummaryCards } from "@/components/provvigioni/provvigioni-summary-cards";
import { ProvvigioniAnomaliesSection } from "@/components/provvigioni/provvigioni-anomalies-section";
import { PaginationNav } from "@/components/ui/pagination-nav";
import {
  getMissingRecurringAlerts,
  getHeliosAbsentAlerts,
  syncAllRecurringMonths,
  syncRecurringMonthsForContract,
  reconcileAllRecurringBounds,
} from "@/lib/recurring-sync";
import {
  computeSupplyStartDate,
  isInFornitura,
} from "@/lib/supply-dates";
import { PAGE_SIZE, pageCount, pageSkip, parsePage } from "@/lib/pagination";
import {
  buildProvvigioniContractWhere,
  buildProvvigioniListWhere,
  recurringMonthlyWhereOr,
  type ProvvigioniListFocus,
} from "@/lib/provvigioni-filters";
import {
  competenceMonthOptions,
  parseProvvigioniTab,
  parseProvvigioniVista,
  vistaToRecurrenceMode,
  type ProvvigioniVista,
} from "@/lib/provvigioni-competence";
import { loadProvvigioniFinancialSummary } from "@/lib/provvigioni-summary";
import { loadProvvigioniTabCounts, activeRecurringContractWhere } from "@/lib/provvigioni-tab-counts";
import {
  buildStornoMaps,
  countExpandedListRows,
  expandContractsToProvvigioneRows,
  fetchExpandedProvvigionePage,
  getRecurringExpandMode,
  loadStornoContractsForMaps,
  type ContractForProvvigioneRow,
} from "@/lib/provvigioni-rows";
import { Button } from "@/components/ui/button";
import { addMonths, periodLabel, toPeriod } from "@/lib/recurring";
import type { Prisma } from "@/generated/prisma/client";
import {
  defaultGettonePrivato,
  type ProvvigioneRow,
} from "@/lib/provvigioni-stato";

export const maxDuration = 60;

export const dynamic = "force-dynamic";

type SearchParams = {
  page?: string;
  collab?: string;
  settled?: string;
  /** Nome fornitore (es. Enel) — filtro su tutto il DB */
  supplier?: string;
  /** Uno o più stati separati da | (es. Da incassare|Incassato) */
  stato?: string;
  /** Business | Domestico */
  tipologia?: string;
  /** client = cognome+nome su tutto il filtro */
  sort?: string;
  dir?: string;
  /** Cerca cliente / POD */
  q?: string;
  /** tutti | mensile | annuale (ricorrente → mensile per link vecchi) */
  vista?: string;
  /** Accesso rapido dalla Dashboard */
  focus?: string;
  /** Mese di competenza YYYY-MM delle ricorrenze */
  competence?: string;
};

export default async function ProvvigioniPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireSession();
  const {
    page: pageRaw,
    collab,
    settled: settledRaw,
    supplier: supplierRaw,
    stato: statoRaw,
    tipologia: tipologiaRaw,
    sort: sortRaw,
    dir: dirRaw,
    q: qRaw,
    vista: vistaRaw,
    focus: focusRaw,
    competence: competenceRaw,
  } = await searchParams;
  const canViewAll = hasPermission(session.role, "commissions.view_all");
  const canConfirm = canConfirmCommission(session.role);
  const canExport = hasPermission(session.role, "reports.export");
  const isScoped = hasPermission(session.role, "contracts.work_scoped");

  const { contractVisibilityWhere } = await import("@/lib/user-scope");
  const visibility = await contractVisibilityWhere(session);

  const supplier = supplierRaw?.trim() || undefined;
  const stato = statoRaw?.trim() || undefined;
  const tipologia = tipologiaRaw?.trim() || undefined;
  const q = qRaw?.trim() || undefined;
  const competenceAll = competenceRaw === "tutti";
  const competencePeriod =
    competenceRaw &&
    competenceRaw !== "tutti" &&
    /^\d{4}-\d{2}$/.test(competenceRaw)
      ? competenceRaw
      : undefined;
  const focus: ProvvigioniListFocus | undefined =
    focusRaw === "da-confermare" || focusRaw === "ricorrenze-mancanti"
      ? focusRaw
      : undefined;
  const vistaTab = parseProvvigioniTab(vistaRaw);
  const vista: ProvvigioniVista = parseProvvigioniVista(vistaRaw);
  const recurrenceMode = vistaToRecurrenceMode(vista);
  const recurringKind =
    focus === "ricorrenze-mancanti"
      ? "all"
      : vista === "annuale"
        ? "annual"
        : "monthly";

  const settledPeriod =
    settledRaw && /^\d{4}-\d{2}$/.test(settledRaw) ? settledRaw : toPeriod(new Date());
  const reconciliationPeriod = addMonths(settledPeriod, -1);
  const showCompetencePanel = vista === "mensile" || vista === "annuale";
  /** Mese competenza: esplicito o default su schede M/R; mai forzato dal solo filtro stato su Tutti */
  const effectiveCompetence = competenceAll
    ? undefined
    : (competencePeriod ??
      (showCompetencePanel ? reconciliationPeriod : undefined));
  const applyCompetenceToList = Boolean(effectiveCompetence);
  /** Valore URL competenza: tutti | YYYY-MM */
  const viewingAllPeriods =
    competenceAll || (!competencePeriod && !showCompetencePanel);
  const competenceQueryValue = viewingAllPeriods
    ? "tutti"
    : effectiveCompetence;

  const collabFilter =
    (canViewAll || isScoped) && collab && collab !== "tutti" ? collab : undefined;

  const statsBaseFilters = {
    canViewAll: canViewAll || isScoped,
    sessionUserId: session.id,
    collab: collabFilter,
    supplier,
    tipologia,
    q,
    recurrenceMode,
    visibility,
  };

  const listFilters = {
    ...statsBaseFilters,
    stato,
    competencePeriod: effectiveCompetence,
  };

  const listWhereOpts = {
    focus,
    effectiveCompetence,
    applyCompetenceToList,
  };

  const contractWhere = buildProvvigioniListWhere({
    filters: listFilters,
    ...listWhereOpts,
  });

  const activeRecurringPeriod = addMonths(toPeriod(new Date()), -1);
  const activeRecurringWhere = activeRecurringContractWhere();
  let collaboratorCountsWhere: Prisma.ContractWhereInput = buildProvvigioniListWhere({
    filters: {
      canViewAll: canViewAll || isScoped,
      sessionUserId: session.id,
      supplier,
      stato,
      tipologia,
      q,
      recurrenceMode,
      visibility,
      competencePeriod: effectiveCompetence,
    },
    focus,
    effectiveCompetence,
    applyCompetenceToList,
  });
  if (vista === "mensile" || vista === "annuale") {
    collaboratorCountsWhere = {
      AND: [collaboratorCountsWhere, activeRecurringWhere],
    };
  }
  const sessionCollabFilter = isScoped
    ? undefined
    : canViewAll
      ? collabFilter && !collabFilter.includes("|")
        ? collabFilter
        : undefined
      : session.id;

  const tabCountsBase = {
    canViewAll: canViewAll || isScoped,
    sessionUserId: session.id,
    collab: collabFilter,
    supplier,
    tipologia,
    q,
    visibility,
  };
  const recurringOperationalView =
    vista === "mensile" || vista === "annuale" || focus === "ricorrenze-mancanti";
  // Sync rate in background: non bloccare il render (evita timeout dopo bulk UT/M/R).
  if (recurringOperationalView) {
    void syncAllRecurringMonths(sessionCollabFilter).catch((e) =>
      console.error("sync all recurring", e),
    );
    void reconcileAllRecurringBounds().catch((e) =>
      console.error("reconcile recurring bounds", e),
    );
  }

  const sortByClient = sortRaw === "client";
  const sortDir: "asc" | "desc" = dirRaw === "desc" ? "desc" : "asc";

  const defaultOrderBy: Prisma.ContractOrderByWithRelationInput[] = [
    { insertionDate: "desc" },
    { createdAt: "desc" },
    { id: "desc" },
  ];

  // Con una ricerca mirata riconcilia subito i contratti trovati; altrimenti usa il sync leggero.
  if (q) {
    const matchingRecurring = await prisma.contract.findMany({
      where: buildProvvigioniContractWhere(statsBaseFilters),
      select: { id: true },
      take: 100,
    });
    await Promise.all(
      matchingRecurring.map((row) =>
        syncRecurringMonthsForContract(row.id).catch((e) =>
          console.error("sync recurring searched contract", e),
        ),
      ),
    );
  } else if (!recurringOperationalView) {
    void syncAllRecurringMonths(sessionCollabFilter).catch((e) =>
      console.error("sync recurring", e),
    );
  }

  // Prima conta: serve per clampare la pagina (evita pagine oltre il totale → elenco vuoto)
  const expandMode = getRecurringExpandMode(
    stato,
    viewingAllPeriods,
    effectiveCompetence,
  );
  const total = expandMode
    ? await countExpandedListRows(contractWhere, expandMode)
    : await prisma.contract.count({ where: contractWhere });
  const pages = pageCount(total);
  const page = Math.min(parsePage(pageRaw), pages);
  const listUsesExpandedRows = Boolean(expandMode);
  const expandFetchAllForSort =
    listUsesExpandedRows && sortByClient && total <= 400;
  const expandUsePaginatedFetch = listUsesExpandedRows && !expandFetchAllForSort;

  const summaryContext = {
    focus,
    effectiveCompetence,
    applyCompetenceToList,
    viewingAllPeriods,
    activeStato: stato,
    activeListWhere: contractWhere,
    activeListTotal: total,
  };

  // Commissoni mancanti: in background (non blocca il caricamento)
  void prisma.contract
    .findMany({
      where: { ...contractWhere, commission: { is: null } },
      select: { id: true },
      take: 20,
    })
    .then((missingCommission) =>
      Promise.all(
        missingCommission.map((c) =>
          prisma.commission
            .create({
              data: {
                contractId: c.id,
                expected: 0,
                accrued: 0,
                received: 0,
                paid: 0,
              },
            })
            .catch(() => null),
        ),
      ),
    )
    .catch(() => null);

  const contractSelect = {
    id: true,
    clientId: true,
    supplierId: true,
    status: true,
    paymentStatus: true,
    recurrence: true,
    podPdr: true,
    pod: true,
    pdr: true,
    collectionDate: true,
    commissionConfirmed: true,
    supplyStartDate: true,
    insertionDate: true,
    createdAt: true,
    expiryDate: true,
    durationMonths: true,
    stornoEndDate: true,
    operationType: true,
    collaboratorId: true,
    notes: true,
    client: {
      select: {
        type: true,
        companyName: true,
        firstName: true,
        lastName: true,
      },
    },
    collaborator: { select: { id: true, name: true } },
    supplier: { select: { id: true, name: true, stornoMonths: true } },
    commission: {
      select: {
        id: true,
        expected: true,
        received: true,
        paid: true,
        stornoDate: true,
        stornoAmount: true,
      },
    },
    recurringMonths: {
      select: { period: true, status: true, amount: true },
      orderBy: { period: "asc" as const },
    },
  } as const;

  // Ordinamento cliente: solo se il filtro non è enorme (altrimenti troppo lento)
  let pageContractIds: string[] | null = null;
  if (sortByClient && !listUsesExpandedRows && total <= 800) {
    const light = await prisma.contract.findMany({
      where: contractWhere,
      select: {
        id: true,
        client: {
          select: {
            type: true,
            companyName: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });
    light.sort((a, b) => {
      const cmp = clientSortKey(a.client).localeCompare(
        clientSortKey(b.client),
        "it",
        { sensitivity: "base", numeric: true },
      );
      return sortDir === "asc" ? cmp : -cmp;
    });
    pageContractIds = light
      .slice(pageSkip(page), pageSkip(page) + PAGE_SIZE)
      .map((r) => r.id);
  }

  const [
    contractsRaw,
    daConfermareCount,
    collaboratorOptions,
    supplierOptions,
    missing,
    heliosAbsent,
    collabGroups,
    deletedRecent,
    tabCounts,
    financialSummary,
  ] = await Promise.all([
    expandUsePaginatedFetch
      ? Promise.resolve([])
      : listUsesExpandedRows
      ? prisma.contract.findMany({
          where: contractWhere,
          select: contractSelect,
          orderBy: defaultOrderBy,
        })
      : pageContractIds
      ? pageContractIds.length === 0
        ? Promise.resolve([])
        : prisma.contract.findMany({
            where: { id: { in: pageContractIds } },
            select: contractSelect,
          })
      : prisma.contract.findMany({
          where: contractWhere,
          select: contractSelect,
          orderBy: defaultOrderBy,
          skip: pageSkip(page),
          take: PAGE_SIZE,
        }),
    prisma.contract.count({
      where: { ...contractWhere, commissionConfirmed: false },
    }),
    canViewAll
      ? prisma.user.findMany({
          where: {
            active: true,
            role: { in: ["COLLABORATORE", "COMMERCIALE", "AREA_MANAGER", "ADMIN", "SEGRETERIA"] },
          },
          select: { id: true, name: true, active: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    prisma.supplier.findMany({
      where: { active: true },
      select: { name: true },
      orderBy: { name: "asc" },
    }),
    getMissingRecurringAlerts(sessionCollabFilter, recurringKind),
    getHeliosAbsentAlerts(sessionCollabFilter),
    canViewAll
      ? prisma.contract.groupBy({
          by: ["collaboratorId"],
          where: collaboratorCountsWhere,
          _count: { id: true },
        })
      : Promise.resolve([]),
    prisma.contract.findMany({
      where: {
        deletedAt: { not: null },
        ...(canViewAll ? {} : { collaboratorId: session.id }),
      },
      select: {
        id: true,
        deletedAt: true,
        podPdr: true,
        client: {
          select: {
            type: true,
            companyName: true,
            firstName: true,
            lastName: true,
          },
        },
        supplier: { select: { name: true } },
        collaborator: { select: { name: true } },
      },
      orderBy: { deletedAt: "desc" },
      take: 12,
    }),
    loadProvvigioniTabCounts(tabCountsBase, activeRecurringPeriod),
    loadProvvigioniFinancialSummary(statsBaseFilters, vistaTab, summaryContext),
  ]);

  const { tutti: countTutti, mensile: countMensili, annuale: countAnnuali } =
    tabCounts;

  let contracts: (typeof contractsRaw)[number][] =
    pageContractIds == null
      ? contractsRaw
      : pageContractIds
          .map((id) => contractsRaw.find((c) => c.id === id))
          .filter((c): c is (typeof contractsRaw)[number] => Boolean(c));

  const buildRowOpts = {
    effectiveCompetence,
    expandMode,
    latestMap: new Map<string, boolean>(),
    earlyMap: new Map<string, boolean>(),
    now: new Date(),
  };
  let prebuiltExpandedRows: ProvvigioneRow[] | null = null;

  if (expandUsePaginatedFetch && expandMode) {
    const stornoContracts = await loadStornoContractsForMaps(contractWhere);
    const stornoMaps = buildStornoMaps(stornoContracts);
    buildRowOpts.latestMap = stornoMaps.latestMap;
    buildRowOpts.earlyMap = stornoMaps.earlyMap;
    const expandedPage = await fetchExpandedProvvigionePage({
      contractWhere,
      expandMode,
      page,
      pageSize: PAGE_SIZE,
      contractSelect,
      buildOpts: buildRowOpts,
      orderBy: defaultOrderBy,
    });
    contracts = expandedPage.contracts as (typeof contractsRaw)[number][];
    prebuiltExpandedRows = expandedPage.rows;
  }

  // Allinea in memoria subito; scrittura DB in background (pagina più veloce)
  const alignJobs: Promise<unknown>[] = [];
  const now = buildRowOpts.now;
  for (const c of contracts) {
    const supply =
      c.supplyStartDate ??
      computeSupplyStartDate(c.insertionDate, c.operationType);
    const inFornitura = isInFornitura(supply, now);

    // Incasso/Pagato prematuro: data futura = attivazione prevista, non pagamento
    // Non toccare «Da controllare»: devono restare visibili così
    if (
      c.collectionDate &&
      !inFornitura &&
      !["KO", "ANNULLATO", "CHIUSO", "DA_CONTROLLARE", "STORNATO"].includes(c.status)
    ) {
      const prevStatus = c.status;
      (c as { collectionDate: Date | null }).collectionDate = null;
      (c as { paymentStatus: string | null }).paymentStatus = "Da incassare";
      const revertStatus =
        prevStatus === "PAGATO_DAL_FORNITORE" ||
        prevStatus === "PROVVIGIONE_LIQUIDATA";
      if (revertStatus) {
        (c as { status: string }).status = "IN_ATTESA_PAGAMENTO";
      }
      alignJobs.push(
        prisma.contract
          .update({
            where: { id: c.id },
            data: {
              collectionDate: null,
              paymentStatus: "Da incassare",
              ...(revertStatus ? { status: "IN_ATTESA_PAGAMENTO" } : {}),
            },
          })
          .catch(() => null),
      );
    }

    const hasDate = Boolean(c.collectionDate) && inFornitura;
    // NON riscrivere KO/CHIUSO → Incassato solo perché c’è collectionDate.
    // Solo se già in fornitura.
    if (hasDate && c.status === "IN_ATTESA_PAGAMENTO") {
      (c as { status: string }).status = "PAGATO_DAL_FORNITORE";
      (c as { paymentStatus: string | null }).paymentStatus = "Incassato";
      alignJobs.push(
        prisma.contract
          .update({
            where: { id: c.id },
            data: {
              status: "PAGATO_DAL_FORNITORE",
              paymentStatus: "Incassato",
            },
          })
          .catch(() => null),
      );
    }
    if (c.client.type === "PRIVATO" && c.commission) {
      const target = defaultGettonePrivato(c.supplier.name);
      const current = Number(c.commission.expected ?? 0);
      if (target != null && current === 0) {
        (c.commission as { expected: unknown }).expected = target;
        alignJobs.push(
          prisma.commission
            .update({
              where: { id: c.commission.id },
              data: { expected: target },
            })
            .catch(() => null),
        );
      }
    }
  }
  if (alignJobs.length > 0) {
    void Promise.all(alignJobs);
  }

  let rows: ProvvigioneRow[];
  if (prebuiltExpandedRows) {
    rows = prebuiltExpandedRows;
  } else {
    const stornoSource = listUsesExpandedRows
      ? await loadStornoContractsForMaps(contractWhere)
      : (contracts as ContractForProvvigioneRow[]);
    const { latestMap, earlyMap } = buildStornoMaps(stornoSource);
    buildRowOpts.latestMap = latestMap;
    buildRowOpts.earlyMap = earlyMap;

    rows = expandContractsToProvvigioneRows(
      contracts as ContractForProvvigioneRow[],
      buildRowOpts,
    );

    if (listUsesExpandedRows && sortByClient) {
      rows.sort((a, b) => {
        const cmp = a.clientName.localeCompare(b.clientName, "it", {
          sensitivity: "base",
          numeric: true,
        });
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    if (listUsesExpandedRows) {
      rows = rows.slice(pageSkip(page), pageSkip(page) + PAGE_SIZE);
    }
  }

  const totals = { daConfermare: daConfermareCount };

  const nameById = Object.fromEntries(collaboratorOptions.map((u) => [u.id, u.name]));
  const collabCounts = collabGroups
    .map((g) => ({
      id: g.collaboratorId,
      name: nameById[g.collaboratorId] ?? g.collaboratorId,
      n: g._count.id,
    }))
    .sort((a, b) => b.n - a.n);

  const selectedCollabIds = (collabFilter ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  const selectedCollabName =
    selectedCollabIds.length > 0
      ? selectedCollabIds
          .map(
            (id) =>
              nameById[id] ?? collabCounts.find((c) => c.id === id)?.name ?? id,
          )
          .join(" + ")
      : null;

  const alertRows = missing.map((m) => ({
    id: m.id,
    period: m.period,
    contractId: m.contractId,
    podPdr: m.contract.podPdr || "",
    supplierName: m.contract.supplier.name,
    clientName: clientDisplayName(m.contract.client),
    collaboratorName: m.contract.collaborator?.name,
    amount: m.amount != null ? Number(m.amount) : undefined,
  }));
  const tabRecurringCount = vista === "annuale" ? countAnnuali : countMensili;
  const missingContractCount = new Set(alertRows.map((a) => a.contractId)).size;
  const otherRecurringCount = Math.max(0, tabRecurringCount - missingContractCount);
  const monthlyStatusRows =
    vista === "mensile"
      ? await prisma.recurringMonth.findMany({
          where: {
            period: { lte: activeRecurringPeriod },
            status: { not: "CLOSED" },
            contract: {
              AND: [
                activeRecurringWhere,
                { OR: recurringMonthlyWhereOr },
                { isHistorical: false, deletedAt: null },
              ],
            },
          },
          select: { period: true, status: true },
        })
      : [];
  const monthlySummary =
    showCompetencePanel
      ? {
          periodLabel: periodLabel(activeRecurringPeriod),
          activeContracts: countMensili,
          matured: monthlyStatusRows.filter((row) => row.period === activeRecurringPeriod).length,
          paid: monthlyStatusRows.filter(
            (row) => row.period === activeRecurringPeriod && ["PAID", "LIQUIDATED"].includes(row.status),
          ).length,
          currentOpen: monthlyStatusRows.filter(
            (row) => row.period === activeRecurringPeriod && ["MISSING", "PENDING"].includes(row.status),
          ).length,
          arrears: monthlyStatusRows.filter(
            (row) => row.period < activeRecurringPeriod && ["MISSING", "PENDING"].includes(row.status),
          ).length,
        }
      : undefined;

  const heliosAbsentRows = heliosAbsent.map((m) => ({
    id: m.id,
    period: m.period,
    contractId: m.contractId,
    podPdr: m.contract.podPdr || "",
    clientName: clientDisplayName(m.contract.client),
    collaboratorName: m.contract.collaborator.name,
    note: m.note,
  }));

  const anomalyCount = alertRows.length + heliosAbsentRows.length;
  const roleLabel = ROLE_LABELS[session.role as AppRole] ?? session.role;
  const queryBase = {
    collab: collabFilter,
    settled: settledPeriod,
    supplier,
    stato,
    tipologia,
    q,
    vista: vistaTab === "tutti" ? undefined : vistaTab,
    focus,
    competence: competenceQueryValue,
    sort: sortByClient ? "client" : undefined,
    dir: sortByClient ? sortDir : undefined,
  };
  const filterHints = [
    selectedCollabName ? `collab. ${selectedCollabName}` : null,
    supplier ? `fornitore ${supplier.split("|").join(" + ")}` : null,
    stato ? `stato ${stato.split("|").join(" + ")}` : null,
    effectiveCompetence && !competenceAll
      ? `competenza ${periodLabel(effectiveCompetence)}`
      : competenceAll
        ? "tutti i mesi"
        : null,
    tipologia ? `tipologia ${tipologia.split("|").join(" + ")}` : null,
    q ? `cerca «${q}»` : null,
    focus === "da-confermare" ? "solo provvigioni da confermare" : null,
    focus === "ricorrenze-mancanti" ? "solo ricorrenze mancanti" : null,
    vistaTab === "mensile"
      ? "scheda M (mensile)"
      : vistaTab === "annuale"
        ? "scheda R (annuale)"
        : "tutti (UT+M+R)",
  ].filter(Boolean);
  const exportParams = new URLSearchParams();
  exportParams.set("settled", settledPeriod);
  if (collabFilter) exportParams.set("collab", collabFilter);
  if (supplier) exportParams.set("supplier", supplier);
  if (stato) exportParams.set("stato", stato);
  if (tipologia) exportParams.set("tipologia", tipologia);
  if (q) exportParams.set("q", q);
  if (vistaTab !== "tutti") exportParams.set("vista", vistaTab);
  if (focus) exportParams.set("focus", focus);
  if (competenceQueryValue) exportParams.set("competence", competenceQueryValue);
  const exportHref = `/api/provvigioni/export?${exportParams.toString()}`;

  function vistaHref(nextVista: "tutti" | "mensile" | "annuale") {
    return `/provvigioni?${new URLSearchParams({
      settled: settledPeriod,
      ...(collabFilter ? { collab: collabFilter } : {}),
      ...(supplier ? { supplier } : {}),
      ...(stato ? { stato } : {}),
      ...(tipologia ? { tipologia } : {}),
      ...(q ? { q } : {}),
      ...(focus ? { focus } : {}),
      ...(competenceQueryValue ? { competence: competenceQueryValue } : {}),
      ...(nextVista !== "tutti" ? { vista: nextVista } : {}),
    }).toString()}`;
  }

  const tabQueryBase: Record<string, string | undefined> = {
    settled: settledPeriod,
    collab: collabFilter,
    supplier,
    tipologia,
    q,
    focus,
    stato,
    ...(competenceQueryValue ? { competence: competenceQueryValue } : {}),
  };

  const sortHint = sortByClient
    ? ` Ordinati per cliente A→Z unico (${sortDir === "asc" ? "A→Z" : "Z→A"}), Domestico e Business insieme.`
    : " Ordinati per data inserimento.";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">
            {vistaTab === "mensile"
              ? "Provvigioni · Ricorrenti mensili (M)"
              : vistaTab === "annuale"
                ? "Provvigioni · Ricorrenti annuali (R)"
                : "Provvigioni"}
          </h1>
          <p className="text-sm text-slate-500 sm:text-base">
            {total} {listUsesExpandedRows ? "voci" : "contratti"} in elenco
            {filterHints.length
              ? ` · ${filterHints.join(" · ")}`
              : canViewAll
                ? ` · ${roleLabel}`
                : " · solo i tuoi"}
            .
            <span className="hidden sm:inline">
              {sortHint} Max {PAGE_SIZE} per pagina.
              {totals.daConfermare > 0
                ? ` · ${totals.daConfermare} da confermare.`
                : ""}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/archivio#helios-import">
            <Button type="button" variant="secondary">
              Importa Helios
            </Button>
          </Link>
          {canExport ? (
            <a href={exportHref}>
              <Button variant="secondary">Scarica Excel</Button>
            </a>
          ) : null}
        </div>
      </div>

      <ProvvigioniVistaTabs
        active={vistaTab}
        counts={{
          tutti: countTutti,
          mensile: countMensili,
          annuale: countAnnuali,
        }}
        queryBase={tabQueryBase}
      />

      <ProvvigioniToolbar
        q={q}
        competencePeriod={effectiveCompetence ?? null}
        competenceAll={viewingAllPeriods}
        monthOptions={competenceMonthOptions()}
        queryBase={tabQueryBase}
        clearHref={vistaHref(vistaTab)}
        canViewAll={canViewAll}
        collabFilter={collabFilter}
        collabCounts={collabCounts.map((c) => ({
          id: c.id,
          name: c.name,
          count: c.n,
        }))}
        selectedCollabIds={selectedCollabIds}
        totalCollabCount={collabCounts.reduce((s, c) => s + c.n, 0)}
      />

      <ProvvigioniSummaryCards
        summary={financialSummary}
        competencePeriod={effectiveCompetence ?? null}
        competenceAll={viewingAllPeriods}
        queryBase={tabQueryBase}
        contractCount={total}
      />

      <ProvvigioniAnomaliesSection alertCount={anomalyCount}>
        {alertRows.length > 0 ? (
          <RecurringMissingPanel
            alerts={alertRows}
            otherRecurringCount={otherRecurringCount}
            kind={recurringKind}
            summary={monthlySummary}
          />
        ) : null}
        {heliosAbsentRows.length > 0 ? (
          <HeliosAbsentPanel alerts={heliosAbsentRows} />
        ) : null}
      </ProvvigioniAnomaliesSection>

      <ProvvigioniTrashPanel
        rows={deletedRecent.map((c) => ({
          id: c.id,
          clientName: clientDisplayName(c.client),
          supplierName: c.supplier.name,
          collaboratorName: c.collaborator.name,
          podPdr: c.podPdr || "",
          deletedAt: c.deletedAt?.toISOString() ?? "",
        }))}
      />

      <PaginationNav
        path="/provvigioni"
        page={page}
        total={total}
        query={queryBase}
        loadedCount={rows.length}
      />

      <ProvvigioniFilterTable
        rows={rows}
        canDelete
        canConfirm={canConfirm}
        listQuery={{
          collab: collabFilter,
          settled: settledPeriod,
          supplier,
          stato,
          tipologia,
          q,
          vista: vistaTab === "tutti" ? undefined : vistaTab,
          focus,
          competence: competenceQueryValue,
        }}
        serverSortKey={sortByClient ? "client" : null}
        serverSortDir={sortDir}
        page={page}
        collaboratorByName={
          canViewAll
            ? Object.fromEntries(collaboratorOptions.map((u) => [u.name, u.id]))
            : undefined
        }
        supplierNames={supplierOptions.map((s) => s.name)}
      />

      <PaginationNav
        path="/provvigioni"
        page={page}
        total={total}
        query={queryBase}
        loadedCount={rows.length}
      />
    </div>
  );
}
