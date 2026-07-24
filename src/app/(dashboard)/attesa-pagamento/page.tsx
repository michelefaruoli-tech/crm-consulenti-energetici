import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { DeleteRowButton } from "@/components/ui/delete-row-button";
import { clientDisplayName } from "@/lib/utils";
import { formatRomeDateTime } from "@/lib/timezone";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AttesaPagamentoPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    collaboratorId?: string;
    supplierId?: string;
  }>;
}) {
  const session = await requireSession();
  const canSeeAll = hasPermission(session.role, "contracts.edit_all");
  if (!canSeeAll && !hasPermission(session.role, "contracts.create")) {
    redirect("/");
  }

  const sp = await searchParams;
  const where = {
    deletedAt: null,
    isHistorical: false,
    sendToMaster: true,
    assignedToMaster: true,
    status: "IN_ATTESA_PAGAMENTO" as const,
    ...(canSeeAll ? {} : { collaboratorId: session.id }),
    ...(sp.collaboratorId ? { collaboratorId: sp.collaboratorId } : {}),
    ...(sp.supplierId ? { supplierId: sp.supplierId } : {}),
    ...(sp.q
      ? {
          OR: [
            { contractNumber: { contains: sp.q, mode: "insensitive" as const } },
            { podPdr: { contains: sp.q, mode: "insensitive" as const } },
            {
              client: {
                OR: [
                  { firstName: { contains: sp.q, mode: "insensitive" as const } },
                  { lastName: { contains: sp.q, mode: "insensitive" as const } },
                  { companyName: { contains: sp.q, mode: "insensitive" as const } },
                ],
              },
            },
          ],
        }
      : {}),
  };

  const [contracts, collaborators, suppliers] = await Promise.all([
    prisma.contract.findMany({
      where,
      include: {
        client: true,
        collaborator: { select: { name: true } },
        supplier: { select: { name: true } },
      },
      orderBy: [{ expectedPaymentDate: "asc" }, { updatedAt: "desc" }],
      take: 200,
    }),
    canSeeAll
      ? prisma.user.findMany({
          where: { active: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    prisma.supplier.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Contratti in attesa di pagamento</h1>
        <p className="text-slate-500">
          Solo pratiche con stato «In attesa di pagamento».
        </p>
        <p className="mt-1 text-sm">
          <Link href="/lavorazione" className="text-emerald-700 underline">
            ← Torna a In lavorazione
          </Link>
        </p>
      </div>

      <form className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-5">
        <Field label="Ricerca">
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Pratica, cliente..." />
        </Field>
        {canSeeAll ? (
          <Field label="Collaboratore">
            <Select name="collaboratorId" defaultValue={sp.collaboratorId ?? ""}>
              <option value="">Tutti</option>
              {collaborators.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Fornitore">
          <Select name="supplierId" defaultValue={sp.supplierId ?? ""}>
            <option value="">Tutti</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end">
          <Button type="submit">Filtra</Button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-3 py-2">Pratica</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Collaboratore</th>
              <th className="px-3 py-2">Fornitore</th>
              <th className="px-3 py-2">Importo atteso</th>
              <th className="px-3 py-2">Data attesa</th>
              <th className="px-3 py-2">Stato</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {contracts.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                  Nessuna pratica in attesa di pagamento.
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
                    {c.expectedPaymentAmount != null
                      ? `€ ${Number(c.expectedPaymentAmount).toFixed(2)}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {c.expectedPaymentDate
                      ? formatRomeDateTime(c.expectedPaymentDate)
                      : "—"}
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
