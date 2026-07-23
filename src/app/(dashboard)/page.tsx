import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/commission";
import { clientDisplayName, formatDate, isContractExpired } from "@/lib/utils";
import { StatCard } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { hasPermission } from "@/lib/permissions";
import { ContractStatus } from "@/generated/prisma/client";

export default async function DashboardPage() {
  const session = await requireSession();
  const canViewAll = hasPermission(session.role, "contracts.edit_all");

  const where = canViewAll ? {} : { collaboratorId: session.id };

  const [
    totalContracts,
    activeContracts,
    inProgress,
    expired,
    blocked,
    commissions,
    topCollaborators,
    recentContracts,
  ] = await Promise.all([
    prisma.contract.count({ where }),
    prisma.contract.count({ where: { ...where, status: "ATTIVATO" } }),
    prisma.contract.count({
      where: {
        ...where,
        status: { in: ["IN_LAVORAZIONE", "INVIATO_AL_FORNITORE", "DOCUMENTAZIONE_COMPLETA"] },
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
          in: ["DOCUMENTAZIONE_INCOMPLETA", "IN_LAVORAZIONE", "IN_ATTESA_PAGAMENTO"],
        },
      },
      take: 5,
      include: { client: true, collaborator: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.commission.aggregate({
      where: canViewAll
        ? {}
        : { contract: { collaboratorId: session.id } },
      _sum: { expected: true, received: true, paid: true, accrued: true },
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
      include: { client: true, supplier: true, collaborator: true },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  const collaboratorNames =
    topCollaborators.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: topCollaborators.map((c) => c.collaboratorId) } },
          select: { id: true, name: true },
        })
      : [];

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
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Pratiche bloccate</h2>
          {blocked.length === 0 ? (
            <p className="text-sm text-slate-500">Nessuna pratica bloccata al momento.</p>
          ) : (
            <ul className="space-y-3">
              {blocked.map((contract) => (
                <li key={contract.id} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3 last:border-0">
                  <div>
                    <Link href={`/contratti/${contract.id}`} className="font-medium text-emerald-700 hover:underline">
                      {contract.contractNumber}
                    </Link>
                    <p className="text-sm text-slate-500">{clientDisplayName(contract.client)}</p>
                  </div>
                  <StatusBadge status={contract.status as ContractStatus} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {hasPermission(session.role, "stats.full") ? (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">Collaboratori più produttivi</h2>
            <ul className="space-y-3">
              {topCollaborators.map((row) => {
                const user = collaboratorNames.find((u) => u.id === row.collaboratorId);
                return (
                  <li key={row.collaboratorId} className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">{user?.name ?? "—"}</span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-sm">{row._count.id} contratti</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Contratti recenti</h2>
          <Link href="/contratti" className="text-sm font-medium text-emerald-700 hover:underline">
            Vedi tutti
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-2 py-2">Numero</th>
                <th className="px-2 py-2">Cliente</th>
                <th className="px-2 py-2">Fornitore</th>
                <th className="px-2 py-2">Stato</th>
                <th className="px-2 py-2">Scadenza</th>
              </tr>
            </thead>
            <tbody>
              {recentContracts.map((contract) => (
                <tr key={contract.id} className="border-b border-slate-100">
                  <td className="px-2 py-3">
                    <Link href={`/contratti/${contract.id}`} className="font-medium text-emerald-700 hover:underline">
                      {contract.contractNumber}
                    </Link>
                  </td>
                  <td className="px-2 py-3">{clientDisplayName(contract.client)}</td>
                  <td className="px-2 py-3">{contract.supplier.name}</td>
                  <td className="px-2 py-3">
                    <StatusBadge status={contract.status} />
                  </td>
                  <td className="px-2 py-3">
                    <span className={isContractExpired(contract.expiryDate) ? "text-red-600" : ""}>
                      {formatDate(contract.expiryDate)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
