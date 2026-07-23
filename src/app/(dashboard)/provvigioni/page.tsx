import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { formatCurrency, commissionDifference } from "@/lib/commission";
import { clientDisplayName } from "@/lib/utils";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";

export default async function ProvvigioniPage() {
  const session = await requireSession();
  const canViewAll = hasPermission(session.role, "commissions.view_all");

  const commissions = await prisma.commission.findMany({
    where: canViewAll ? {} : { contract: { collaboratorId: session.id } },
    include: {
      contract: {
        include: {
          client: true,
          collaborator: { select: { name: true } },
          supplier: true,
        },
      },
      entries: { orderBy: { createdAt: "desc" }, take: 3 },
    },
    orderBy: { updatedAt: "desc" },
  });

  const totals = commissions.reduce(
    (acc, item) => {
      acc.expected += Number(item.expected);
      acc.received += Number(item.received);
      acc.paid += Number(item.paid);
      return acc;
    },
    { expected: 0, received: 0, paid: 0 },
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Provvigioni</h1>
        <p className="text-slate-500">Calcolo automatico e storico provvigioni</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Totale previsto</p>
          <p className="mt-2 text-2xl font-bold">{formatCurrency(totals.expected)}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <p className="text-sm text-emerald-700">Totale ricevuto</p>
          <p className="mt-2 text-2xl font-bold text-emerald-900">{formatCurrency(totals.received)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Totale liquidato</p>
          <p className="mt-2 text-2xl font-bold">{formatCurrency(totals.paid)}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3">Contratto</th>
              <th className="px-4 py-3">Cliente</th>
              {canViewAll ? <th className="px-4 py-3">Collaboratore</th> : null}
              <th className="px-4 py-3">Prevista</th>
              <th className="px-4 py-3">Ricevuta</th>
              <th className="px-4 py-3">Liquidata</th>
              <th className="px-4 py-3">Differenza</th>
              <th className="px-4 py-3">Stato</th>
            </tr>
          </thead>
          <tbody>
            {commissions.map((item) => {
              const diff = commissionDifference(
                Number(item.expected),
                Number(item.received),
                Number(item.paid),
              );
              return (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <Link href={`/contratti/${item.contractId}`} className="font-medium text-emerald-700 hover:underline">
                      {item.contract.contractNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{clientDisplayName(item.contract.client)}</td>
                  {canViewAll ? <td className="px-4 py-3">{item.contract.collaborator.name}</td> : null}
                  <td className="px-4 py-3">{formatCurrency(item.expected)}</td>
                  <td className="px-4 py-3">{formatCurrency(item.received)}</td>
                  <td className="px-4 py-3">{formatCurrency(item.paid)}</td>
                  <td className="px-4 py-3">
                    <span className={diff.vsExpected !== 0 ? "text-amber-700" : "text-slate-600"}>
                      {formatCurrency(diff.vsExpected)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={item.contract.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
