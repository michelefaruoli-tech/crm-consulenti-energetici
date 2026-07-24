import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/commission";
import { hasPermission } from "@/lib/permissions";
import { StatCard } from "@/components/ui/card";
import { ContractsFilterTable } from "@/components/contracts/contracts-filter-table";
import { toCollaboratorOption, toContractRow } from "@/lib/contract-row";
import { StatusBadge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireSession();
  const canViewAll = hasPermission(session.role, "contracts.edit_all");
  const canChangeCollaborator = hasPermission(
    session.role,
    "contracts.change_collaborator_dashboard",
  );
  const where = canViewAll
    ? { isHistorical: false, deletedAt: null }
    : { collaboratorId: session.id, isHistorical: false, deletedAt: null };

  try {
    const [
      totalContracts,
      inLavorazioneCount,
      completatoCount,
      koCount,
      emailFailedCount,
      expired,
      inLavorazioneList,
      commissions,
      topCollaborators,
      recentContracts,
      collaboratorOptions,
    ] = await Promise.all([
      prisma.contract.count({ where }),
      prisma.contract.count({
        where: {
          ...where,
          sendToMaster: true,
          assignedToMaster: true,
          status: "IN_LAVORAZIONE",
        },
      }),
      prisma.contract.count({
        where: {
          ...where,
          status: { in: ["COMPLETATO", "ATTIVATO"] },
        },
      }),
      prisma.contract.count({
        where: {
          ...where,
          status: "KO",
        },
      }),
      prisma.contract.count({
        where: {
          ...where,
          sendToMaster: true,
          emailStatus: { in: ["FAILED", "ERROR", "ATTACHMENT_ERROR", "SKIPPED_NO_SMTP"] },
        },
      }),
      prisma.contract.count({
        where: {
          ...where,
          expiryDate: { lt: new Date() },
          status: { notIn: ["CHIUSO", "ANNULLATO", "KO", "COMPLETATO"] },
        },
      }),
      prisma.contract.findMany({
        where: {
          ...where,
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
          createdAt: true,
          supplyStartDate: true,
          operationType: true,
          utilityType: true,
          podPdr: true,
          pod: true,
          pdr: true,
          serviceOther: true,
          collaboratorId: true,
          client: {
            select: { type: true, companyName: true, firstName: true, lastName: true },
          },
          supplier: { select: { name: true } },
          collaborator: { select: { id: true, name: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 30,
      }),
      canChangeCollaborator
        ? prisma.user.findMany({
            where: {
              role: { in: ["COLLABORATORE", "COMMERCIALE", "ADMIN", "SEGRETERIA"] },
            },
            select: { id: true, name: true, active: true, role: true },
            orderBy: [{ active: "desc" }, { name: "asc" }],
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

    const tableRows = recentContracts.map(toContractRow);
    const collaborators = collaboratorOptions.map(toCollaboratorOption);

    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500">Panoramica attività e produzione</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Contratti totali" value={totalContracts} />
          <Link href="/lavorazione">
            <StatCard label="In lavorazione" value={inLavorazioneCount} tone="warning" />
          </Link>
          <Link href="/contratti">
            <StatCard label="Completati" value={completatoCount} tone="success" />
          </Link>
          <StatCard label="KO" value={koCount} tone="danger" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Link href="/lavorazione">
            <StatCard label="Email da reinviare" value={emailFailedCount} tone="danger" />
          </Link>
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
                          href={`/lavorazione/${contract.id}`}
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
            Ultimi inserimenti per primi. Usa ▾ sulle colonne per filtrare.
          </p>
          <ContractsFilterTable
            rows={tableRows}
            canDelete
            canChangeCollaborator={canChangeCollaborator}
            collaborators={collaborators}
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
