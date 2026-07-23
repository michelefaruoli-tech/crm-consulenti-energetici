import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/commission";
import { hasPermission } from "@/lib/permissions";
import { StatCard } from "@/components/ui/card";
import { ContractsFilterTable } from "@/components/contracts/contracts-filter-table";
import { toContractRow } from "@/lib/contract-row";
import { StatusBadge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireSession();
  const canViewAll = hasPermission(session.role, "contracts.edit_all");
  const where = canViewAll
    ? { isHistorical: false, deletedAt: null }
    : { collaboratorId: session.id, isHistorical: false, deletedAt: null };

  try {
    const [
      totalContracts,
      activeContracts,
      inProgress,
      expired,
      inLavorazioneList,
      commissions,
      topCollaborators,
      recentContracts,
    ] = await Promise.all([
      prisma.contract.count({ where }),
      prisma.contract.count({ where: { ...where, status: "ATTIVATO" } }),
      prisma.contract.count({
        where: {
          ...where,
          status: {
            in: [
              "BOZZA",
              "INSERITO",
              "IN_LAVORAZIONE",
              "INVIATO_AL_FORNITORE",
              "DOCUMENTAZIONE_COMPLETA",
              "DA_LAVORARE",
              "INVIATO_AL_MASTER",
              "ERRORE_INVIO",
            ],
          },
        },
      }),
      prisma.contract.count({
        where: {
          ...where,
          expiryDate: { lt: new Date() },
          status: { notIn: ["CHIUSO", "ANNULLATO"] },
        },
      }),
      prisma.contract.findMany({
        where: {
          ...where,
          status: {
            in: [
              "BOZZA",
              "INSERITO",
              "DOCUMENTAZIONE_INCOMPLETA",
              "DOCUMENTAZIONE_COMPLETA",
              "DA_LAVORARE",
              "INVIATO_AL_MASTER",
              "ERRORE_INVIO",
              "IN_LAVORAZIONE",
              "INVIATO_AL_FORNITORE",
            ],
          },
        },
        take: 20,
        select: {
          id: true,
          status: true,
          contractNumber: true,
          client: { select: { firstName: true, lastName: true, companyName: true, type: true } },
          collaborator: { select: { name: true } },
          supplier: { select: { name: true } },
        },
        orderBy: { insertionDate: "desc" },
      }),
      prisma.commission.aggregate({
        where: canViewAll ? {} : { contract: { collaboratorId: session.id } },
        _sum: { expected: true, received: true, paid: true },
      }),
      hasPermission(session.role, "stats.full")
        ? prisma.contract.groupBy({
            by: ["collaboratorId"],
            _count: { id: true },
            orderBy: { _count: { id: "desc" } },
            take: 5,
          })
        : Promise.resolve([]),
      prisma.contract.findMany({
        where,
        select: {
          id: true,
          status: true,
          insertionDate: true,
          supplyStartDate: true,
          operationType: true,
          podPdr: true,
          client: {
            select: { type: true, companyName: true, firstName: true, lastName: true },
          },
          supplier: { select: { name: true } },
          collaborator: { select: { name: true } },
        },
        orderBy: { insertionDate: "desc" },
        take: 30,
      }),
    ]);

    const collaboratorNames =
      topCollaborators.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: topCollaborators.map((c) => c.collaboratorId) } },
            select: { id: true, name: true },
          })
        : [];

    const tableRows = recentContracts.map(toContractRow);

    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500">Panoramica attività e produzione</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Contratti totali" value={totalContracts} />
          <StatCard label="Contratti attivi" value={activeContracts} tone="success" />
          <StatCard label="In lavorazione" value={inProgress} tone="warning" />
          <StatCard label="Scaduti / da rinnovare" value={expired} tone="danger" />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <StatCard
            label="Provvigioni previste"
            value={formatCurrency(Number(commissions._sum.expected ?? 0))}
          />
          <StatCard
            label="Provvigioni ricevute"
            value={formatCurrency(Number(commissions._sum.received ?? 0))}
            tone="success"
          />
          <StatCard
            label="Provvigioni liquidate"
            value={formatCurrency(Number(commissions._sum.paid ?? 0))}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              Pratiche in lavorazione
            </h2>
            <p className="mb-3 text-xs text-slate-500">
              Include bozze, salvati, da lavorare e in lavorazione. Clicca per aprire.
            </p>
            {inLavorazioneList.length === 0 ? (
              <p className="text-sm text-slate-500">Nessuna pratica in lavorazione.</p>
            ) : (
              <ul className="space-y-3">
                {inLavorazioneList.map((contract) => {
                  const name =
                    contract.client.type === "AZIENDA" && contract.client.companyName
                      ? contract.client.companyName
                      : [contract.client.firstName, contract.client.lastName]
                          .filter(Boolean)
                          .join(" ") || "Cliente";
                  return (
                    <li
                      key={contract.id}
                      className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3 last:border-0"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/contratti/${contract.id}`}
                          className="font-medium text-emerald-700 hover:underline"
                        >
                          {name}
                        </Link>
                        <p className="truncate text-sm text-slate-500">
                          {contract.contractNumber} · {contract.supplier.name} ·{" "}
                          {contract.collaborator.name}
                        </p>
                      </div>
                      <StatusBadge status={contract.status} />
                    </li>
                  );
                })}
              </ul>
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
            <h2 className="text-lg font-semibold text-slate-900">Contratti recenti</h2>
            <Link
              href="/contratti"
              className="text-sm font-medium text-emerald-700 hover:underline"
            >
              Vedi tutti
            </Link>
          </div>
          <p className="text-xs text-slate-500">
            Usa ▾ sulle colonne per filtrare (selezione multipla).
          </p>
          <ContractsFilterTable rows={tableRows} />
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
