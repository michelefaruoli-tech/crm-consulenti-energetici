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

  try {
    const [
      totalContracts,
      totalAllContracts,
      totalArchiveContracts,
      inLavorazioneCount,
      completatoCount,
      koCount,
      emailFailedCount,
      expired,
      inLavorazioneList,
      moneyTotals,
      commissioniDaConfermare,
      incassateDaLiquidare,
      ricorrenzeMancanti,
      storniRegistrati,
      topCollaborators,
      listTotal,
      recentContracts,
      collaboratorOptions,
    ] = await Promise.all([
      prisma.contract.count({ where: whereActive }),
      prisma.contract.count({ where: whereAll }),
      prisma.contract.count({
        where: canViewAll
          ? { isHistorical: true, deletedAt: null }
          : { collaboratorId: session.id, isHistorical: true, deletedAt: null },
      }),
      prisma.contract.count({
        where: {
          ...whereActive,
          sendToMaster: true,
          assignedToMaster: true,
          status: "IN_LAVORAZIONE",
        },
      }),
      prisma.contract.count({
        where: {
          ...whereActive,
          status: { in: ["COMPLETATO", "ATTIVATO"] },
        },
      }),
      prisma.contract.count({
        where: {
          ...whereActive,
          status: "KO",
        },
      }),
      prisma.contract.count({
        where: {
          ...whereActive,
          sendToMaster: true,
          emailStatus: { in: ["FAILED", "ERROR", "ATTACHMENT_ERROR", "SKIPPED_NO_SMTP"] },
        },
      }),
      prisma.contract.count({
        where: {
          ...whereActive,
          expiryDate: { lt: new Date() },
          status: { notIn: ["CHIUSO", "ANNULLATO", "KO", "COMPLETATO"] },
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
      hasPermission(session.role, "stats.full")
        ? prisma.contract.groupBy({
            by: ["collaboratorId"],
            where: { deletedAt: null },
            _count: { id: true },
            orderBy: { _count: { id: "desc" } },
            take: 20,
          })
        : Promise.resolve([]),
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
    ]);

    const collaboratorNames =
      topCollaborators.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: topCollaborators.map((c) => c.collaboratorId) } },
            select: { id: true, name: true },
          })
        : [];

    const tableRows = toContractRows(recentContracts);
    const collaborators = collaboratorOptions.map(toCollaboratorOption);

    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500">
            Panoramica attività e produzione · contratti ordinati per data inserimento (più
            recenti prima) · {PAGE_SIZE} per pagina
            {canViewAll ? (
              <>
                {" "}
                · elenco completo anche in{" "}
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

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Contratti totali" value={totalAllContracts} />
          <StatCard label="Attivi (operativi)" value={totalContracts} />
          <Link href="/archivio">
            <StatCard label="In archivio" value={totalArchiveContracts} />
          </Link>
          <Link href="/lavorazione">
            <StatCard label="In lavorazione" value={inLavorazioneCount} tone="warning" />
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Link href="/contratti">
            <StatCard label="Completati" value={completatoCount} tone="success" />
          </Link>
          <StatCard label="KO" value={koCount} tone="danger" />
          <Link href="/lavorazione">
            <StatCard label="Email da reinviare" value={emailFailedCount} tone="danger" />
          </Link>
          <StatCard label="Scaduti / da rinnovare" value={expired} tone="danger" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Link href="/provvigioni">
            <StatCard
              label="Provvigioni complessive"
              value={formatCurrency(moneyTotals.complessivo)}
              hint="Ricevute + da incassare"
            />
          </Link>
          <Link href="/provvigioni?stato=Incassato">
            <StatCard
              label="Ricevute (incassate)"
              value={formatCurrency(moneyTotals.incassato)}
              tone="success"
              hint="Con data di incasso"
            />
          </Link>
          <Link href="/provvigioni?stato=Da%20incassare">
            <StatCard
              label="Da incassare"
              value={formatCurrency(moneyTotals.daIncassare)}
              tone="warning"
              hint="Senza data di incasso"
            />
          </Link>
          <Link href="/provvigioni?vista=ricorrente">
            <StatCard
              label="Ricorrenti mensili"
              value={formatCurrency(moneyTotals.ricorrenti)}
              hint="Somma gettoni contratti R"
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
              <p className="mt-1 text-sm text-slate-500">
                Le verifiche più importanti, ordinate per il lavoro quotidiano.
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
              Aggiornato ora
            </span>
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
                  <span aria-hidden className="text-lg leading-none opacity-50 transition group-hover:translate-x-0.5">
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
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900">
                Contratti in lavorazione
              </h2>
              <Link
                href="/lavorazione"
                className="text-sm font-medium text-emerald-700 hover:underline"
              >
                Vedi tutti
              </Link>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              Solo pratiche inviate al Master (non bozze / registrazioni interne).
            </p>
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

          {hasPermission(session.role, "stats.full") ? (
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-slate-900">
                Collaboratori più produttivi
              </h2>
              <ul className="space-y-3">
                {topCollaborators.map((row) => {
                  const user = collaboratorNames.find((u) => u.id === row.collaboratorId);
                  return (
                    <li
                      key={row.collaboratorId}
                      className="flex items-center justify-between"
                    >
                      <span className="text-sm font-medium text-slate-700">
                        {user?.name ?? "—"}
                      </span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-sm">
                        {row._count.id} contratti
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">
              {q?.trim() ? `Risultati ricerca` : "Contratti recenti"}
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
            Usa ▾ sulle colonne per filtrare; usa le pagine sotto per scorrere.
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
