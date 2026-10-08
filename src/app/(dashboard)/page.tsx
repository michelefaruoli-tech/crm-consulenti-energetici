import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { StatCard } from "@/components/ui/card";
import { ContractsFilterTable } from "@/components/contracts/contracts-filter-table";
import { DashboardLavorazioneList } from "@/components/contracts/dashboard-lavorazione-list";
import { PaginationNav } from "@/components/ui/pagination-nav";
import { ListSearchForm } from "@/components/ui/list-search-form";
import { toCollaboratorOption, toContractRows } from "@/lib/contract-row";
import { PAGE_SIZE, pageSkip, parsePage } from "@/lib/pagination";
import { contractTextSearchWhere } from "@/lib/list-search";
import { fetchMarketPrices } from "@/lib/market-prices";
import {
  aggregateCollaboratorRanking,
  aggregateSupplierRanking,
  aggregateUtilityRanking,
  parseDashboardYear,
  productiveCollaboratorsSubtitle,
  resolveProductiveCollaboratorsAudience,
  shouldShowProductiveCollaboratorsCard,
  startOfMonth,
  startOfWeekMonday,
} from "@/lib/dashboard-aggregates";
import { loadMonthlyContractCounts } from "@/lib/dashboard-monthly-counts";
import { DashboardRankingPanel } from "@/components/dashboard/dashboard-ranking-panel";
import { DashboardMonthlyBreakdown } from "@/components/dashboard/dashboard-monthly-breakdown";
import { MarketPricesPanel } from "@/components/dashboard/market-prices-panel";
import { StornoDashboardSection } from "@/components/dashboard/storno-dashboard-section";
import { DashboardOperativaSection } from "@/components/dashboard/dashboard-operativa-section";
import {
  buildStornoDashboardScopeWhere,
  buildStornoKpiCards,
  loadStornoDashboardAlerts,
  loadStornoDashboardKpis,
  parseDashboardCollabParam,
  parseDashboardSupplierIds,
  resolveOptionalDashboardPeriod,
} from "@/lib/storno-dashboard-kpi";
import {
  buildDashboardQuickActions,
  buildOperativaKpiCards,
  loadOperativaAlerts,
  loadOperativaMoneyBundle,
  loadStorniPeriodTotals,
  resolveOperativaCompetenceMonth,
  sumRicorrentiMensiliCompetence,
} from "@/lib/dashboard-operativa";
import { recentMonthOptions } from "@/lib/report-month";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    q?: string;
    anno?: string;
    collab?: string;
    supplierId?: string;
    from?: string;
    to?: string;
    month?: string;
  }>;
}) {
  const session = await requireSession();
  const {
    page: pageRaw,
    q,
    anno,
    collab: collabRaw,
    supplierId: supplierIdRaw,
    from: fromRaw,
    to: toRaw,
    month: monthRaw,
  } = await searchParams;
  const page = parsePage(pageRaw);
  const canViewAll = hasPermission(session.role, "contracts.edit_all");
  const canChangeCollaborator = hasPermission(
    session.role,
    "contracts.change_collaborator_dashboard",
  );
  const canChangeStatus = hasPermission(session.role, "contracts.change_status");
  const isAdminStats = hasPermission(session.role, "stats.full");
  const isScoped = hasPermission(session.role, "contracts.work_scoped");
  const showCollabFilter = canViewAll || isScoped;
  const {
    contractVisibilityWhere,
    countActiveNetworkCollaborators,
    loadVisibleCollaboratorOptions,
  } = await import("@/lib/user-scope");
  const visibility = await contractVisibilityWhere(session);
  const activeNetworkCollaboratorCount = isAdminStats
    ? 0
    : await countActiveNetworkCollaborators(session.id);
  const productiveAudience = resolveProductiveCollaboratorsAudience({
    isAdminStats,
    activeNetworkCollaboratorCount,
  });
  const showProductiveCard =
    shouldShowProductiveCollaboratorsCard(productiveAudience);
  const productiveRankingWhere = isAdminStats
    ? { deletedAt: null as null }
    : { deletedAt: null as null, ...visibility };
  const stornoCollab = showCollabFilter
    ? parseDashboardCollabParam(collabRaw)
    : undefined;
  const stornoSupplierIds = parseDashboardSupplierIds(supplierIdRaw);
  const stornoPeriod = resolveOptionalDashboardPeriod({
    from: fromRaw,
    to: toRaw,
    month: monthRaw,
  });
  const stornoScopeWhere = buildStornoDashboardScopeWhere({
    visibility,
    collab: stornoCollab,
    supplierIds: stornoSupplierIds,
  });
  const textSearch = contractTextSearchWhere(q);
  const whereActive = {
    isHistorical: false as const,
    deletedAt: null as null,
    ...visibility,
  };
  const whereAll = { deletedAt: null as null, ...visibility };
  const listTotalWhere = {
    ...whereActive,
    ...(textSearch ? { AND: [textSearch] } : {}),
  };

  const now = new Date();
  const weekStart = startOfWeekMonday(now);
  const monthStart = startOfMonth(now);
  const currentYear = now.getFullYear();
  const selectedYear = parseDashboardYear(anno, currentYear);

  try {
    const [
      insertedThisWeek,
      insertedThisMonth,
      insertedTotal,
      currentYearMonthlyCountsRaw,
      inLavorazioneCount,
      inLavorazioneList,
      topCollaboratorsAllTime,
      topCollaboratorsMonth,
      rankingRows,
      listTotal,
      recentContracts,
      collaboratorOptions,
      marketPrices,
      stornoCollabOptions,
      stornoSupplierOptions,
    ] = await Promise.all([
      prisma.contract.count({
        where: { ...whereAll, insertionDate: { gte: weekStart } },
      }),
      prisma.contract.count({
        where: { ...whereAll, insertionDate: { gte: monthStart } },
      }),
      prisma.contract.count({ where: whereAll }),
      loadMonthlyContractCounts({ where: whereAll, year: currentYear }),
      prisma.contract.count({
        where: {
          ...whereActive,
          sendToMaster: true,
          assignedToMaster: true,
          status: "IN_LAVORAZIONE",
        },
      }),
      prisma.contract.findMany({
        where: {
          ...whereActive,
          sendToMaster: true,
          assignedToMaster: true,
          status: "IN_LAVORAZIONE",
        },
        take: 12,
        select: {
          id: true,
          status: true,
          contractNumber: true,
          sentToMasterAt: true,
          client: {
            select: { firstName: true, lastName: true, companyName: true, type: true },
          },
          collaborator: { select: { name: true } },
          supplier: { select: { name: true } },
        },
        orderBy: [{ sentToMasterAt: "desc" }, { createdAt: "desc" }],
      }),
      showProductiveCard
        ? prisma.contract.groupBy({
            by: ["collaboratorId"],
            where: productiveRankingWhere,
            _count: { id: true },
            orderBy: { _count: { id: "desc" } },
            take: 30,
          })
        : Promise.resolve([]),
      showProductiveCard
        ? prisma.contract.groupBy({
            by: ["collaboratorId"],
            where: {
              ...productiveRankingWhere,
              insertionDate: { gte: monthStart },
            },
            _count: { id: true },
            orderBy: { _count: { id: "desc" } },
            take: 30,
          })
        : Promise.resolve([]),
      prisma.contract.findMany({
        where: whereAll,
        select: {
          utilityType: true,
          supplier: { select: { name: true } },
        },
      }),
      prisma.contract.count({ where: listTotalWhere }),
      prisma.contract.findMany({
        where: listTotalWhere,
        select: {
          id: true,
          clientId: true,
          status: true,
          insertionDate: true,
          createdAt: true,
          supplyStartDate: true,
          operationType: true,
          utilityType: true,
          podPdr: true,
          pod: true,
          pdr: true,
          serviceOther: true,
          collaboratorId: true,
          recurrence: true,
          expiryDate: true,
          durationMonths: true,
          stornoEndDate: true,
          collectionDate: true,
          client: {
            select: { type: true, companyName: true, firstName: true, lastName: true },
          },
          supplier: { select: { id: true, name: true, stornoMonths: true } },
          collaborator: { select: { id: true, name: true } },
        },
        orderBy: [{ insertionDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        skip: pageSkip(page),
        take: PAGE_SIZE,
      }),
      canChangeCollaborator
        ? prisma.user.findMany({
            where: {
              active: true,
              role: { in: ["COLLABORATORE", "COMMERCIALE", "AREA_MANAGER", "ADMIN", "SEGRETERIA"] },
            },
            select: { id: true, name: true, active: true, role: true },
            orderBy: { name: "asc" },
          })
        : Promise.resolve([]),
      fetchMarketPrices(),
      loadVisibleCollaboratorOptions(session),
      prisma.supplier.findMany({
        where: {
          AND: [
            {
              OR: [{ active: true }, { contracts: { some: {} } }],
            },
            { NOT: { code: { contains: "_MERGED_" } } },
            { NOT: { name: { contains: "(unito in" } } },
            { NOT: { name: { startsWith: "_archivio_" } } },
          ],
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);

    const { counts: stornoCounts, doppiaIds } = await loadStornoDashboardKpis({
      db: prisma,
      scopeWhere: stornoScopeWhere,
      now,
      period: stornoPeriod,
    });
    const stornoSupplierName =
      stornoSupplierIds.length === 1
        ? (stornoSupplierOptions.find((s) => s.id === stornoSupplierIds[0])
            ?.name ?? null)
        : null;
    const stornoLinkExtras = {
      collab: stornoCollab,
      supplierName: stornoSupplierName,
    };
    const stornoKpiCards = buildStornoKpiCards(stornoCounts, stornoLinkExtras);
    const stornoAlerts = await loadStornoDashboardAlerts({
      db: prisma,
      scopeWhere: stornoScopeWhere,
      now,
      period: stornoPeriod,
      collab: stornoCollab,
      supplierName: stornoSupplierName,
      doppiaIds,
    });

    // P1.3 — KPI economici / alert / azioni (serie dopo storno per Neon HTTP)
    const operativaScope = stornoScopeWhere;
    const operativaMoney = await loadOperativaMoneyBundle(operativaScope);
    const competenceMese = resolveOperativaCompetenceMonth({
      now,
      period: stornoPeriod,
    });
    const ricorrentiMese = await sumRicorrentiMensiliCompetence({
      contractWhere: operativaScope,
      competence: competenceMese,
      now,
    });
    const storniPeriodo = await loadStorniPeriodTotals({
      scopeWhere: operativaScope,
      period: stornoPeriod,
    });
    const operativaKpis = buildOperativaKpiCards({
      money: operativaMoney,
      ricorrentiMese,
      storni: storniPeriodo,
      competence: competenceMese,
      period: stornoPeriod,
      linkExtras: stornoLinkExtras,
    });
    const operativaAlerts = await loadOperativaAlerts({
      scopeWhere: operativaScope,
      now,
      doppiaIds,
      linkExtras: stornoLinkExtras,
    });
    const quickActions = buildDashboardQuickActions(stornoLinkExtras);

    const collaboratorIds = [
      ...new Set([
        ...topCollaboratorsAllTime.map((c) => c.collaboratorId),
        ...topCollaboratorsMonth.map((c) => c.collaboratorId),
      ]),
    ];
    const collaboratorNames =
      collaboratorIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: collaboratorIds } },
            select: { id: true, name: true },
          })
        : [];

    const nameById = new Map(collaboratorNames.map((u) => [u.id, u.name]));

    const topAllTime = aggregateCollaboratorRanking(
      topCollaboratorsAllTime.map((row) => ({
        collaboratorId: row.collaboratorId,
        collaboratorName: nameById.get(row.collaboratorId) ?? "—",
        count: row._count.id,
      })),
    );

    const topMonth = aggregateCollaboratorRanking(
      topCollaboratorsMonth.map((row) => ({
        collaboratorId: row.collaboratorId,
        collaboratorName: nameById.get(row.collaboratorId) ?? "—",
        count: row._count.id,
      })),
    );

    const supplierRanking = aggregateSupplierRanking(
      rankingRows.map((r) => ({ supplierName: r.supplier.name })),
    );
    const utilityRanking = aggregateUtilityRanking(
      rankingRows.map((r) => ({ utilityType: r.utilityType })),
    );

    const tableRows = toContractRows(recentContracts);
    const collaborators = collaboratorOptions.map(toCollaboratorOption);

    // Mese corrente: riusa il valore già calcolato per "Inseriti questo
    // mese" (query senza limite superiore) invece del conteggio a range
    // chiuso, così il totale del mese in questa tabella coincide sempre,
    // byte per byte, con quella card — e la somma dei 12 mesi resta uguale
    // a "Inseriti quest'anno" per costruzione.
    const currentYearMonthlyCounts = [...currentYearMonthlyCountsRaw];
    currentYearMonthlyCounts[now.getMonth()] = insertedThisMonth;
    const insertedThisYear = currentYearMonthlyCounts.reduce((a, b) => a + b, 0);

    const monthlyCounts =
      selectedYear === currentYear
        ? currentYearMonthlyCounts
        : await loadMonthlyContractCounts({ where: whereAll, year: selectedYear });

    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500">
            Panoramica produzione, mercati e provvigioni
            {canViewAll ? (
              <>
                {" "}
                · elenco completo in{" "}
                <Link href="/contratti?vista=tutti" className="underline">
                  Contratti
                </Link>{" "}
                e{" "}
                <Link href="/provvigioni" className="underline">
                  Provvigioni
                </Link>
              </>
            ) : null}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Inseriti questa settimana" value={insertedThisWeek} />
          <StatCard label="Inseriti questo mese" value={insertedThisMonth} />
          <StatCard label="Inseriti quest'anno" value={insertedThisYear} />
          <StatCard label="Totale di sempre" value={insertedTotal} />
        </div>

        <DashboardMonthlyBreakdown
          year={selectedYear}
          counts={monthlyCounts}
          currentYear={currentYear}
          currentMonthIndex={now.getMonth()}
        />

        <div className="grid gap-6 lg:grid-cols-2">
          <DashboardRankingPanel
            title="Classifica fornitori utilizzati"
            subtitle="Fornitori più usati nei contratti (nomi unificati)"
            items={supplierRanking}
          />
          <DashboardRankingPanel
            title="Classifica per tipo"
            subtitle="Distribuzione per tipologia utenza"
            items={utilityRanking}
          />
        </div>

        <MarketPricesPanel prices={marketPrices} />

        <DashboardOperativaSection
          kpis={operativaKpis}
          alerts={operativaAlerts}
          actions={quickActions}
        />

        <StornoDashboardSection
          cards={stornoKpiCards}
          alerts={stornoAlerts}
          collaborators={stornoCollabOptions}
          suppliers={stornoSupplierOptions}
          monthOptions={recentMonthOptions(24)}
          showCollabFilter={showCollabFilter}
          filters={{
            collab: stornoCollab,
            supplierId:
              stornoSupplierIds.length === 1
                ? stornoSupplierIds[0]
                : supplierIdRaw?.trim() || undefined,
            month: monthRaw?.trim() || undefined,
            from: stornoPeriod?.from,
            to: stornoPeriod?.to,
            q: q?.trim() || undefined,
            anno: anno?.trim() || undefined,
          }}
        />

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <Link href="/lavorazione" className="block flex-1">
                <StatCard
                  label="Contratti in lavorazione"
                  value={inLavorazioneCount}
                  tone="warning"
                  hint="Clicca per aprire la pagina lavorazioni"
                />
              </Link>
            </div>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">Elenco pratiche</h2>
              <Link
                href="/lavorazione"
                className="text-sm font-medium text-emerald-700 hover:underline"
              >
                Vedi tutti
              </Link>
            </div>
            {inLavorazioneList.length === 0 ? (
              <p className="text-sm text-slate-500">Nessun contratto inviato al Master.</p>
            ) : (
              <DashboardLavorazioneList
                canChangeStatus={canChangeStatus}
                items={inLavorazioneList.map((c) => ({
                  id: c.id,
                  status: c.status,
                  contractNumber: c.contractNumber,
                  client: {
                    type: c.client.type,
                    firstName: c.client.firstName,
                    lastName: c.client.lastName,
                    companyName: c.client.companyName,
                  },
                  supplier: { name: c.supplier.name },
                  collaborator: { name: c.collaborator.name },
                }))}
              />
            )}
          </section>

          {showProductiveCard ? (
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-1 text-lg font-semibold text-slate-900">
                Collaboratori più produttivi
              </h2>
              <p className="mb-4 text-sm text-slate-500">
                {productiveCollaboratorsSubtitle(productiveAudience)}
              </p>

              <div className="grid gap-6 sm:grid-cols-2">
                <div>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Di sempre
                  </h3>
                  <ul className="space-y-2">
                    {topAllTime.map((row, i) => (
                      <li
                        key={`all-${row.label}`}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="font-medium text-slate-700">
                          {i + 1}. {row.label}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 tabular-nums font-semibold">
                          {row.count}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Mese in corso
                  </h3>
                  <ul className="space-y-2">
                    {topMonth.length === 0 ? (
                      <li className="text-sm text-slate-500">Nessun inserimento questo mese.</li>
                    ) : (
                      topMonth.map((row, i) => (
                        <li
                          key={`month-${row.label}`}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <span className="font-medium text-slate-700">
                            {i + 1}. {row.label}
                          </span>
                          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 tabular-nums font-semibold text-emerald-800">
                            {row.count}
                          </span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </div>
            </section>
          ) : null}
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">
              {q?.trim() ? "Risultati ricerca" : "Contratti recenti"}
            </h2>
            <Link
              href="/contratti?vista=tutti"
              className="text-sm font-medium text-emerald-700 hover:underline"
            >
              Vedi tutti
            </Link>
          </div>
          <ListSearchForm action="/" q={q} />
          <p className="text-xs text-slate-500">
            {q?.trim()
              ? `${listTotal} contratti trovati per «${q.trim()}».`
              : "Ordinati per data inserimento (più recenti prima)."}{" "}
            {PAGE_SIZE} per pagina.
          </p>
          <PaginationNav
            path="/"
            page={page}
            total={listTotal}
            query={{ q: q?.trim() || undefined }}
          />
          <ContractsFilterTable
            rows={tableRows}
            editable
            canDelete={canViewAll}
            canChangeCollaborator={canChangeCollaborator}
            canChangeStatus={canChangeStatus}
            collaborators={collaborators}
          />
          <PaginationNav
            path="/"
            page={page}
            total={listTotal}
            query={{ q: q?.trim() || undefined }}
          />
        </section>
      </div>
    );
  } catch (error) {
    console.error("Dashboard error", error);
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
        <h1 className="text-lg font-semibold">Errore dashboard</h1>
        <p className="mt-2 text-sm">
          {error instanceof Error ? error.message : "Errore sconosciuto"}
        </p>
        <p className="mt-2 text-xs">Ricarica la pagina tra qualche secondo.</p>
      </div>
    );
  }
}
