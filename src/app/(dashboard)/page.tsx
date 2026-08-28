import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/commission";
import { hasPermission } from "@/lib/permissions";
import { StatCard } from "@/components/ui/card";
import { ContractsFilterTable } from "@/components/contracts/contracts-filter-table";
import { DashboardLavorazioneList } from "@/components/contracts/dashboard-lavorazione-list";
import { PaginationNav } from "@/components/ui/pagination-nav";
import { ListSearchForm } from "@/components/ui/list-search-form";
import { toCollaboratorOption, toContractRows } from "@/lib/contract-row";
import { PAGE_SIZE, pageSkip, parsePage } from "@/lib/pagination";
import {
  provvigioneStatoWhere,
  recurringAnnualWhereOr,
  recurringMonthlyWhereOr,
  sumProvvigioniTotals,
} from "@/lib/provvigioni-filters";
import { contractTextSearchWhere } from "@/lib/list-search";
import { toPeriod } from "@/lib/recurring";
import { fetchMarketPrices } from "@/lib/market-prices";
import {
  aggregateCollaboratorRanking,
  aggregateSupplierRanking,
  aggregateUtilityRanking,
  startOfMonth,
  startOfWeekMonday,
} from "@/lib/dashboard-aggregates";
import { DashboardRankingPanel } from "@/components/dashboard/dashboard-ranking-panel";
import { MarketPricesPanel } from "@/components/dashboard/market-prices-panel";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const session = await requireSession();
  const { page: pageRaw, q } = await searchParams;
  const page = parsePage(pageRaw);
  const canViewAll = hasPermission(session.role, "contracts.edit_all");
  const canChangeCollaborator = hasPermission(
    session.role,
    "contracts.change_collaborator_dashboard",
  );
  const canChangeStatus = hasPermission(session.role, "contracts.change_status");
  const isAdminStats = hasPermission(session.role, "stats.full");
  const { contractVisibilityWhere } = await import("@/lib/user-scope");
  const visibility = await contractVisibilityWhere(session);
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

  try {
    const [
      insertedThisWeek,
      insertedThisMonth,
      insertedTotal,
      inLavorazioneCount,
      inLavorazioneList,
      moneyTotals,
      commissioniDaConfermare,
      incassateDaLiquidare,
      ricorrenzeMancanti,
      storniRegistrati,
      topCollaboratorsAllTime,
      topCollaboratorsMonth,
      rankingRows,
      listTotal,
      recentContracts,
      collaboratorOptions,
      marketPrices,
    ] = await Promise.all([
      prisma.contract.count({
        where: { ...whereAll, insertionDate: { gte: weekStart } },
      }),
      prisma.contract.count({
        where: { ...whereAll, insertionDate: { gte: monthStart } },
      }),
      prisma.contract.count({ where: whereAll }),
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
      sumProvvigioniTotals(
        canViewAll
          ? { deletedAt: null }
          : { deletedAt: null, collaboratorId: session.id },
      ),
      prisma.contract.count({
        where: { ...whereActive, commissionConfirmed: false },
      }),
      prisma.contract.count({
        where: {
          AND: [whereActive, provvigioneStatoWhere("Incassato") ?? {}],
        },
      }),
      prisma.recurringMonth.count({
        where: {
          status: "MISSING",
          period: { lt: toPeriod(new Date()) },
          contract: {
            ...whereActive,
            OR: [...recurringMonthlyWhereOr, ...recurringAnnualWhereOr],
          },
        },
      }),
      prisma.contract.count({
        where: {
          AND: [
            whereActive,
            {
              OR: [
                { status: "STORNATO" },
                { commission: { stornoDate: { not: null } } },
              ],
            },
          ],
        },
      }),
      isAdminStats
        ? prisma.contract.groupBy({
            by: ["collaboratorId"],
            where: { deletedAt: null },
            _count: { id: true },
            orderBy: { _count: { id: "desc" } },
            take: 30,
          })
        : Promise.resolve([]),
      isAdminStats
        ? prisma.contract.groupBy({
            by: ["collaboratorId"],
            where: { deletedAt: null, insertionDate: { gte: monthStart } },
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
    ]);

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

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Inseriti questa settimana" value={insertedThisWeek} />
          <StatCard label="Inseriti questo mese" value={insertedThisMonth} />
          <StatCard label="Totale di sempre" value={insertedTotal} />
        </div>

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

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Link href="/provvigioni">
            <StatCard
              label="Totale complessivo"
              value={formatCurrency(moneyTotals.complessivo)}
              hint="Ricevute + da incassare"
            />
          </Link>
          <Link href="/provvigioni?stato=Incassato">
            <StatCard
              label="Totale ricevute"
              value={formatCurrency(moneyTotals.incassato)}
              tone="success"
              hint="Provvigioni incassate"
            />
          </Link>
          <Link href="/provvigioni?stato=Da%20incassare">
            <StatCard
              label="Da incassare"
              value={formatCurrency(moneyTotals.daIncassare)}
              tone="warning"
            />
          </Link>
          <Link href="/provvigioni?vista=ricorrente">
            <StatCard
              label="Ricorrenti mensili"
              value={formatCurrency(moneyTotals.ricorrenti)}
              hint="Gettoni contratti ricorrenti"
            />
          </Link>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
                Priorità operative
              </p>
              <h2 className="mt-1 text-xl font-bold text-slate-900">Da gestire</h2>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: "Provvigioni da confermare",
                value: commissioniDaConfermare,
                href: "/provvigioni?focus=da-confermare",
                hint: "Controlla il gettone previsto",
                tone: "border-amber-200 bg-amber-50 text-amber-950",
              },
              {
                label: "Incassate da liquidare",
                value: incassateDaLiquidare,
                href: "/provvigioni?stato=Incassato",
                hint: "Fornitore pagato, collaboratore no",
                tone: "border-emerald-200 bg-emerald-50 text-emerald-950",
              },
              {
                label: "Ricorrenze mancanti",
                value: ricorrenzeMancanti,
                href: "/provvigioni?focus=ricorrenze-mancanti",
                hint: "Rate attese nei mesi precedenti",
                tone: "border-sky-200 bg-sky-50 text-sky-950",
              },
              {
                label: "Storni registrati",
                value: storniRegistrati,
                href: "/provvigioni?stato=Stornato",
                hint: "Controlla importi e competenza",
                tone: "border-rose-200 bg-rose-50 text-rose-950",
              },
            ].map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`group rounded-xl border p-4 transition hover:-translate-y-0.5 hover:shadow-md ${item.tone}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold leading-tight">{item.label}</p>
                  <span
                    aria-hidden
                    className="text-lg leading-none opacity-50 transition group-hover:translate-x-0.5"
                  >
                    →
                  </span>
                </div>
                <p className="mt-3 text-3xl font-bold tabular-nums">{item.value}</p>
                <p className="mt-2 text-xs leading-snug opacity-75">{item.hint}</p>
              </Link>
            ))}
          </div>
        </section>

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

          {isAdminStats ? (
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-1 text-lg font-semibold text-slate-900">
                Collaboratori più produttivi
              </h2>
              <p className="mb-4 text-sm text-slate-500">Solo admin · nomi unificati</p>

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
