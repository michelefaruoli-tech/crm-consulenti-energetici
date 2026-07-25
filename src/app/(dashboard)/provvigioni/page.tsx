import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { canConfirmCommission, hasPermission } from "@/lib/permissions";
import { formatCurrency } from "@/lib/commission";
import { formatMonthYear } from "@/lib/date-parse";
import { clientDisplayName } from "@/lib/utils";
import { ROLE_LABELS, type AppRole } from "@/lib/constants";
import {
  ProvvigioniFilterTable,
  type ProvvigioneRow,
} from "@/components/provvigioni/provvigioni-filter-table";
import { RecurringMissingPanel } from "@/components/provvigioni/recurring-missing-panel";
import {
  RecurringRendicontoPanel,
  toSettledRow,
} from "@/components/provvigioni/recurring-rendiconto-panel";
import { PaginationNav } from "@/components/ui/pagination-nav";
import { Button } from "@/components/ui/button";
import {
  getMissingRecurringAlerts,
  getSettledRecurringForPeriod,
  syncAllRecurringMonths,
} from "@/lib/recurring-sync";
import {
  markEarlyReswitchContracts,
  markLatestContractsByPod,
  resolveStornoInfo,
} from "@/lib/storno-status";
import { computeSupplyStartDate } from "@/lib/supply-dates";
import { PAGE_SIZE, pageCount, pageSkip, parsePage } from "@/lib/pagination";
import { buildProvvigioniContractWhere } from "@/lib/provvigioni-filters";
import { toPeriod } from "@/lib/recurring";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

type SearchParams = {
  page?: string;
  collab?: string;
  settled?: string;
  /** client = cognome+nome su tutto il filtro */
  sort?: string;
  dir?: string;
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
    sort: sortRaw,
    dir: dirRaw,
  } = await searchParams;
  const canViewAll = hasPermission(session.role, "commissions.view_all");
  const canConfirm = canConfirmCommission(session.role);
  const canExport = hasPermission(session.role, "reports.export");

  const contractWhere = buildProvvigioniContractWhere({
    canViewAll,
    sessionUserId: session.id,
    collab,
  });
  const collabFilter =
    canViewAll && collab && collab !== "tutti" ? collab : undefined;
  const sessionCollabFilter = canViewAll ? collabFilter : session.id;
  const settledPeriod =
    settledRaw && /^\d{4}-\d{2}$/.test(settledRaw) ? settledRaw : toPeriod(new Date());

  const sortByClient = sortRaw === "client";
  const sortDir: "asc" | "desc" = dirRaw === "desc" ? "desc" : "asc";

  const orderBy: Prisma.ContractOrderByWithRelationInput[] = sortByClient
    ? [
        { client: { lastName: sortDir } },
        { client: { firstName: sortDir } },
        { client: { companyName: sortDir } },
        { id: "asc" },
      ]
    : [{ insertionDate: "desc" }, { createdAt: "desc" }, { id: "desc" }];

  void syncAllRecurringMonths(sessionCollabFilter).catch((e) =>
    console.error("sync recurring", e),
  );

  // Prima conta: serve per clampare la pagina (evita pagine oltre il totale → elenco vuoto)
  const total = await prisma.contract.count({ where: contractWhere });
  const pages = pageCount(total);
  const page = Math.min(parsePage(pageRaw), pages);

  // Crea commissioni mancanti (senza di esse la tabella le nascondeva → “righe vuote”)
  const missingCommission = await prisma.contract.findMany({
    where: { ...contractWhere, commission: { is: null } },
    select: { id: true },
    take: 500,
  });
  if (missingCommission.length > 0) {
    await Promise.all(
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
    );
  }

  const [
    contracts,
    sumAgg,
    daConfermareCount,
    collaboratorOptions,
    missing,
    collabGroups,
    settledRowsRaw,
  ] = await Promise.all([
    prisma.contract.findMany({
      where: contractWhere,
      select: {
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
          select: { id: true, expected: true, received: true, paid: true },
        },
      },
      orderBy,
      skip: pageSkip(page),
      take: PAGE_SIZE,
    }),
    prisma.commission.aggregate({
      where: { contract: contractWhere },
      _sum: { expected: true, received: true, paid: true },
    }),
    prisma.contract.count({
      where: { ...contractWhere, commissionConfirmed: false },
    }),
    canViewAll
      ? prisma.user.findMany({
          where: {
            role: { in: ["COLLABORATORE", "COMMERCIALE", "ADMIN", "SEGRETERIA"] },
          },
          select: { id: true, name: true, active: true },
          orderBy: [{ active: "desc" }, { name: "asc" }],
        })
      : Promise.resolve([]),
    getMissingRecurringAlerts(sessionCollabFilter),
    canViewAll
      ? prisma.contract.groupBy({
          by: ["collaboratorId"],
          where: { deletedAt: null },
          _count: { id: true },
        })
      : Promise.resolve([]),
    getSettledRecurringForPeriod(settledPeriod, sessionCollabFilter),
  ]);

  const latestMap = markLatestContractsByPod(
    contracts.map((c) => ({
      id: c.id,
      clientId: c.clientId,
      supplierId: c.supplierId,
      podPdr: c.podPdr || c.pod || c.pdr,
      supplyStartDate: c.supplyStartDate,
      insertionDate: c.insertionDate,
      createdAt: c.createdAt,
    })),
  );
  const earlyMap = markEarlyReswitchContracts(
    contracts.map((c) => ({
      id: c.id,
      clientId: c.clientId,
      supplierId: c.supplierId,
      podPdr: c.podPdr || c.pod || c.pdr,
      supplyStartDate: c.supplyStartDate,
      insertionDate: c.insertionDate,
      createdAt: c.createdAt,
      collectionDate: c.collectionDate,
      stornoMonths: c.supplier.stornoMonths,
      stornoEndDate: c.stornoEndDate,
    })),
  );

  const expected = Number(sumAgg._sum.expected ?? 0);
  const received = Number(sumAgg._sum.received ?? 0);
  const paidAmt = Number(sumAgg._sum.paid ?? 0);
  const totals = {
    complessivo: expected,
    ricevuto: received,
    liquidato: paidAmt,
    daAvere: Math.max(received - paidAmt, 0),
    daConfermare: daConfermareCount,
  };

  const rows: ProvvigioneRow[] = contracts.map((contract) => {
    const item = contract.commission;
    const hasDate = Boolean(contract.collectionDate);
    const paidLabel = hasDate ? "Incassato" : "Da incassare";
    const collectionMonth = hasDate ? formatMonthYear(contract.collectionDate) : "";
    const supply =
      contract.supplyStartDate ??
      computeSupplyStartDate(contract.insertionDate, contract.operationType);
    const storno = resolveStornoInfo({
      status: contract.status,
      recurrence: contract.recurrence,
      supplyStartDate: supply,
      stornoMonths: contract.supplier.stornoMonths,
      stornoEndDate: contract.stornoEndDate,
      expiryDate: contract.expiryDate,
      durationMonths: contract.durationMonths,
      isLatestForPod: latestMap.get(contract.id) ?? true,
      collectionDate: contract.collectionDate,
      isEarlyReswitch: earlyMap.get(contract.id) ?? false,
    });

    return {
      id: contract.id,
      clientId: contract.clientId,
      commissionId: item?.id ?? "",
      clientName: clientDisplayName(contract.client),
      podPdr: contract.podPdr || "",
      collaboratorName: contract.collaborator.name,
      supplierName: contract.supplier.name,
      clientType: contract.client.type === "AZIENDA" ? "Business" : "Domestico",
      amount: String(Number(item?.expected ?? 0)),
      recurrence: contract.recurrence || "Una tantum",
      paymentStatus: paidLabel,
      confirmed: contract.commissionConfirmed ? "Confermata" : "Da confermare",
      collectionMonth,
      stornoLabel: storno.label,
      stornoRowClass: storno.rowClassName,
      warnOnEdit: storno.warnOnEdit,
      gettoneBorderClass: contract.commissionConfirmed
        ? "border-l-4 border-l-emerald-600"
        : "border-l-4 border-l-amber-500",
    };
  });

  const nameById = Object.fromEntries(collaboratorOptions.map((u) => [u.id, u.name]));
  const collabCounts = collabGroups
    .map((g) => ({
      id: g.collaboratorId,
      name: nameById[g.collaboratorId] ?? g.collaboratorId,
      n: g._count.id,
    }))
    .sort((a, b) => b.n - a.n);

  const selectedCollabName = collabFilter
    ? nameById[collabFilter] ?? collabCounts.find((c) => c.id === collabFilter)?.name
    : null;

  const alertRows = missing.map((m) => ({
    id: m.id,
    period: m.period,
    contractId: m.contractId,
    podPdr: m.contract.podPdr || "",
    supplierName: m.contract.supplier.name,
    clientName: clientDisplayName(m.contract.client),
  }));

  const settledRows = settledRowsRaw.map(toSettledRow);
  const roleLabel = ROLE_LABELS[session.role as AppRole] ?? session.role;
  const queryBase = {
    collab: collabFilter,
    settled: settledPeriod,
    sort: sortByClient ? "client" : undefined,
    dir: sortByClient ? sortDir : undefined,
  };
  const collabQs = collabFilter ? `&collab=${collabFilter}` : "";
  const exportHref = `/api/provvigioni/export?settled=${settledPeriod}${
    collabFilter ? `&collab=${collabFilter}` : ""
  }`;

  const sortHint = sortByClient
    ? ` Ordinati per cliente (cognome + nome, ${sortDir === "asc" ? "A→Z" : "Z→A"}) su tutto il filtro.`
    : " Ordinati per data inserimento.";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Provvigioni</h1>
          <p className="text-slate-500">
            {total} contratti
            {selectedCollabName
              ? ` · filtro: ${selectedCollabName}`
              : canViewAll
                ? ` · accesso ${roleLabel} — tutti i collaboratori`
                : " · solo i tuoi"}
            .{sortHint} Max {PAGE_SIZE} righe per pagina. Colori = storno; bordo =
            gettone.
            {totals.daConfermare > 0
              ? ` · ${totals.daConfermare} gettoni da confermare.`
              : ""}
          </p>
        </div>
        {canExport ? (
          <a href={exportHref}>
            <Button variant="secondary">Scarica Excel</Button>
          </a>
        ) : null}
      </div>

      {canViewAll ? (
        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href={`/provvigioni?settled=${settledPeriod}`}
            className={
              !collabFilter
                ? "rounded-lg bg-slate-800 px-3 py-1.5 text-white"
                : "rounded-lg bg-slate-100 px-3 py-1.5 text-slate-700"
            }
          >
            Tutti i collaboratori ({collabCounts.reduce((s, c) => s + c.n, 0)})
          </Link>
          {collabCounts.map((c) => (
            <Link
              key={c.id}
              href={`/provvigioni?collab=${c.id}&settled=${settledPeriod}`}
              className={
                collabFilter === c.id
                  ? "rounded-lg bg-slate-800 px-3 py-1.5 text-white"
                  : "rounded-lg bg-slate-100 px-3 py-1.5 text-slate-700"
              }
            >
              {c.name} ({c.n})
            </Link>
          ))}
        </div>
      ) : null}

      <RecurringMissingPanel alerts={alertRows} />

      <RecurringRendicontoPanel
        settledPeriod={settledPeriod}
        rows={settledRows}
        collabQuery={collabQs}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">
            {selectedCollabName
              ? `Complessivo — ${selectedCollabName}`
              : "Totale complessivo (previsto)"}
          </p>
          <p className="mt-2 text-2xl font-bold">{formatCurrency(totals.complessivo)}</p>
          <p className="mt-1 text-xs text-slate-400">
            {selectedCollabName
              ? `Solo questo collaboratore (tutte le pagine)`
              : "Tutti i collaboratori visibili (tutte le pagine)"}
          </p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <p className="text-sm text-emerald-700">
            {selectedCollabName
              ? `Ricevuto — ${selectedCollabName}`
              : "Totale ricevuto"}
          </p>
          <p className="mt-2 text-2xl font-bold text-emerald-900">
            {formatCurrency(totals.ricevuto)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">
            {selectedCollabName
              ? `Liquidato — ${selectedCollabName}`
              : "Totale liquidato"}
          </p>
          <p className="mt-2 text-2xl font-bold">{formatCurrency(totals.liquidato)}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <p className="text-sm text-amber-800">
            {selectedCollabName
              ? `Da avere — ${selectedCollabName}`
              : "Totale da avere"}
          </p>
          <p className="mt-2 text-2xl font-bold text-amber-950">
            {formatCurrency(totals.daAvere)}
          </p>
          <p className="mt-1 text-xs text-amber-800/70">Ricevuto − liquidato</p>
        </div>
      </div>

      <PaginationNav path="/provvigioni" page={page} total={total} query={queryBase} />

      <ProvvigioniFilterTable
        rows={rows}
        canDelete
        canConfirm={canConfirm}
        listQuery={{ collab: collabFilter, settled: settledPeriod }}
        serverSortKey={sortByClient ? "client" : null}
        serverSortDir={sortDir}
      />

      <PaginationNav path="/provvigioni" page={page} total={total} query={queryBase} />
    </div>
  );
}
