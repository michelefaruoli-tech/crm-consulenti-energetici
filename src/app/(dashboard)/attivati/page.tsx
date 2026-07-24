import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeleteRowButton } from "@/components/ui/delete-row-button";
import { clientDisplayName } from "@/lib/utils";
import { formatRomeDateTime } from "@/lib/timezone";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AttivatiPage() {
  const session = await requireSession();
  const canSeeAll = hasPermission(session.role, "contracts.edit_all");
  if (!canSeeAll && !hasPermission(session.role, "contracts.create")) {
    redirect("/");
  }

  const contracts = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      status: "ATTIVATO",
      ...(canSeeAll ? {} : { collaboratorId: session.id }),
    },
    include: {
      client: true,
      collaborator: { select: { name: true } },
      supplier: { select: { name: true } },
    },
    orderBy: [{ activationDate: "desc" }, { updatedAt: "desc" }],
    take: 200,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Contratti attivati</h1>
        <p className="text-slate-500">Pratiche con stato «Attivato».</p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-3 py-2">Pratica</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Collaboratore</th>
              <th className="px-3 py-2">Fornitore</th>
              <th className="px-3 py-2">Attivazione</th>
              <th className="px-3 py-2">Stato</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {contracts.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                  Nessun contratto attivato.
                </td>
              </tr>
            ) : (
              contracts.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs">{c.contractNumber}</td>
                  <td className="px-3 py-2">{clientDisplayName(c.client)}</td>
                  <td className="px-3 py-2">{c.collaborator.name}</td>
                  <td className="px-3 py-2">{c.supplier.name}</td>
                  <td className="px-3 py-2">
                    {c.activationDate ? formatRomeDateTime(c.activationDate) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col items-end gap-1">
                      <Link href={`/lavorazione/${c.id}`}>
                        <Button type="button" size="sm" variant="secondary">
                          Apri scheda
                        </Button>
                      </Link>
                      <DeleteRowButton kind="contract" id={c.id} />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
