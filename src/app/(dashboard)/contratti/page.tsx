import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { clientDisplayName, formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CONTRACT_STATUS_LABELS } from "@/lib/constants";
import { ContractStatus } from "@/generated/prisma/client";

export default async function ContrattiPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const session = await requireSession();
  const { status, q } = await searchParams;
  const canViewAll = hasPermission(session.role, "contracts.edit_all");

  const contracts = await prisma.contract.findMany({
    where: {
      ...(canViewAll ? {} : { collaboratorId: session.id }),
      ...(status ? { status: status as ContractStatus } : {}),
      ...(q
        ? {
            OR: [
              { contractNumber: { contains: q, mode: "insensitive" } },
              { client: { firstName: { contains: q, mode: "insensitive" } } },
              { client: { lastName: { contains: q, mode: "insensitive" } } },
              { client: { companyName: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: {
      client: true,
      supplier: true,
      collaborator: { select: { name: true } },
      commission: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Contratti</h1>
          <p className="text-slate-500">Gestione pratiche e stati</p>
        </div>
        {hasPermission(session.role, "contracts.create") ? (
          <Link href="/contratti/nuovo">
            <Button>Nuovo contratto</Button>
          </Link>
        ) : null}
      </div>

      <form className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Cerca numero contratto o cliente..."
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <select name="status" defaultValue={status ?? ""} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
          <option value="">Tutti gli stati</option>
          {Object.entries(CONTRACT_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary">
          Filtra
        </Button>
      </form>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3">Numero</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Fornitore</th>
              <th className="px-4 py-3">Collaboratore</th>
              <th className="px-4 py-3">Stato</th>
              <th className="px-4 py-3">Scadenza</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((contract) => (
              <tr key={contract.id} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <Link href={`/contratti/${contract.id}`} className="font-medium text-emerald-700 hover:underline">
                    {contract.contractNumber}
                  </Link>
                </td>
                <td className="px-4 py-3">{clientDisplayName(contract.client)}</td>
                <td className="px-4 py-3">{contract.supplier.name}</td>
                <td className="px-4 py-3">{contract.collaborator.name}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={contract.status} />
                </td>
                <td className="px-4 py-3">{formatDate(contract.expiryDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
