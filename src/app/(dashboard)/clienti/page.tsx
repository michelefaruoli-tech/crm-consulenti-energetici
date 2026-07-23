import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { clientDisplayName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/permissions";

export default async function ClientiPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireSession();
  const { q } = await searchParams;
  const canViewAll = hasPermission(session.role, "clients.edit_all");

  const clients = await prisma.client.findMany({
    where: q
      ? {
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { companyName: { contains: q, mode: "insensitive" } },
            { fiscalCode: { contains: q, mode: "insensitive" } },
            { vatNumber: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
          ...(canViewAll ? {} : { createdById: session.id }),
        }
      : canViewAll
        ? {}
        : { createdById: session.id },
    include: {
      _count: { select: { contracts: true } },
      createdBy: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Clienti</h1>
          <p className="text-slate-500">Archivio clienti e ricerca istantanea</p>
        </div>
        {hasPermission(session.role, "clients.create") ? (
          <Link href="/clienti/nuovo">
            <Button>Nuovo cliente</Button>
          </Link>
        ) : null}
      </div>

      <form className="flex gap-3">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Cerca per nome, CF, P.IVA, email..."
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <Button type="submit" variant="secondary">
          Cerca
        </Button>
      </form>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Contatti</th>
              <th className="px-4 py-3">Contratti</th>
              <th className="px-4 py-3">Creato da</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.id} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <Link href={`/clienti/${client.id}`} className="font-medium text-emerald-700 hover:underline">
                    {clientDisplayName(client)}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {client.fiscalCode || client.vatNumber || "—"}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <p>{client.email || "—"}</p>
                  <p className="text-xs text-slate-500">{client.phone || "—"}</p>
                </td>
                <td className="px-4 py-3">{client._count.contracts}</td>
                <td className="px-4 py-3">{client.createdBy.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
