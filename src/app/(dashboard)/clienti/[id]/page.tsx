import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { clientDisplayName, formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default async function ClienteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;

  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      createdBy: { select: { name: true } },
      contracts: {
        include: { supplier: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!client) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{clientDisplayName(client)}</h1>
          <p className="text-slate-500">
            {client.type === "AZIENDA" ? "Azienda" : "Privato"} · Creato da {client.createdBy.name}
          </p>
        </div>
        <Link href={`/contratti/nuovo?clientId=${client.id}`}>
          <Button>Nuovo contratto</Button>
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-900">Anagrafica</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-slate-500">CF</dt><dd>{client.fiscalCode || "—"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">P.IVA</dt><dd>{client.vatNumber || "—"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Email</dt><dd>{client.email || "—"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Telefono</dt><dd>{client.phone || "—"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Indirizzo</dt><dd>{client.address || "—"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Città</dt><dd>{[client.city, client.province, client.zipCode].filter(Boolean).join(" ") || "—"}</dd></div>
          </dl>
          {client.notes ? (
            <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{client.notes}</p>
          ) : null}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-900">Contratti ({client.contracts.length})</h2>
          <ul className="space-y-3">
            {client.contracts.map((contract) => (
              <li key={contract.id} className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0">
                <div>
                  <Link href={`/contratti/${contract.id}`} className="font-medium text-emerald-700 hover:underline">
                    {contract.contractNumber}
                  </Link>
                  <p className="text-xs text-slate-500">{contract.supplier.name} · {formatDate(contract.insertionDate)}</p>
                </div>
                <StatusBadge status={contract.status} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
