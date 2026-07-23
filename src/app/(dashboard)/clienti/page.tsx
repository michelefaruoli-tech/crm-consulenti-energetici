import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { clientDisplayName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/permissions";
import { ClientsFilterTable } from "@/components/clients/clients-filter-table";

export default async function ClientiPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireSession();
  const { q } = await searchParams;
  const canViewAll = hasPermission(session.role, "clients.edit_all");

  const clients = await prisma.client.findMany({
    where: {
      ...(canViewAll ? {} : { createdById: session.id }),
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { companyName: { contains: q, mode: "insensitive" } },
              { fiscalCode: { contains: q, mode: "insensitive" } },
              { vatNumber: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      _count: { select: { contracts: true } },
      createdBy: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const rows = clients.map((c) => ({
    id: c.id,
    name: clientDisplayName(c),
    type: c.type === "AZIENDA" ? "Business" : "Privato",
    fiscalCode: c.fiscalCode || c.vatNumber || "—",
    phone: c.phone || "—",
    email: c.email || "—",
    city: c.city || "—",
    contracts: String(c._count.contracts),
    createdBy: c.createdBy.name,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Clienti</h1>
          <p className="text-slate-500">Clicca una riga per aprire e modificare la scheda</p>
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
          placeholder="Cerca nome, CF, P.IVA, email, telefono..."
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <Button type="submit" variant="secondary">
          Cerca
        </Button>
      </form>

      <ClientsFilterTable rows={rows} />
    </div>
  );
}
