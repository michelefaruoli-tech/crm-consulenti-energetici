import Link from "next/link";
import { redirect } from "next/navigation";
import { Archive } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { formatCurrency } from "@/lib/commission";
import { Button } from "@/components/ui/button";
import { ContractsFilterTable } from "@/components/contracts/contracts-filter-table";
import { toContractRow } from "@/lib/contract-row";
import { ArchiveImportForm } from "@/components/archive/archive-import-form";

export const dynamic = "force-dynamic";

export default async function ArchivioPage() {
  const session = await requireSession();
  if (!hasPermission(session.role, "contracts.edit_all")) {
    redirect("/contratti");
  }

  const [contracts, batches, totals] = await Promise.all([
    prisma.contract.findMany({
      where: { isHistorical: true },
      select: {
        id: true,
        status: true,
        insertionDate: true,
        supplyStartDate: true,
        operationType: true,
        podPdr: true,
        archiveLabel: true,
        isHistorical: true,
        client: {
          select: { type: true, companyName: true, firstName: true, lastName: true },
        },
        supplier: { select: { name: true } },
        collaborator: { select: { name: true } },
      },
      orderBy: { insertionDate: "desc" },
      take: 500,
    }),
    prisma.contract.groupBy({
      by: ["archiveLabel"],
      where: { isHistorical: true },
      _count: { id: true },
    }),
    prisma.commission.aggregate({
      where: { contract: { isHistorical: true } },
      _sum: { expected: true, received: true, paid: true },
    }),
  ]);

  const rows = contracts.map(toContractRow);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <Archive className="h-6 w-6 text-emerald-700" />
          Archivio storico
        </h1>
        <p className="text-slate-500">
          Contratti già pagati importati solo per report e consultazione. Non compaiono in
          Provvigioni attive.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Contratti in archivio</p>
          <p className="mt-2 text-2xl font-bold">{contracts.length}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <p className="text-sm text-emerald-700">Totale gettoni storico</p>
          <p className="mt-2 text-2xl font-bold text-emerald-900">
            {formatCurrency(Number(totals._sum.expected ?? 0))}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Lotti importati</p>
          <ul className="mt-2 space-y-1 text-sm">
            {batches.length === 0 ? (
              <li className="text-slate-400">Nessuno ancora</li>
            ) : (
              batches.map((b) => (
                <li key={b.archiveLabel ?? "—"}>
                  <span className="font-medium">{b.archiveLabel || "Senza nome"}</span>
                  {" · "}
                  {b._count.id}
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-2 font-semibold text-slate-900">Importa database già pagati</h2>
        <p className="mb-4 text-sm text-slate-500">
          Carica un Excel (.xlsx). Prima riga = intestazioni. Colonne utili: Nome, Cognome,
          Ragione sociale, Tipo, Fornitore, POD/PDR, Data, Gettone, Collaboratore. Ogni file
          diventa un lotto storico con l&apos;etichetta che indichi.
        </p>
        <ArchiveImportForm />
      </section>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Contratti archiviati</h2>
        <Link href="/report" className="text-sm text-emerald-700 hover:underline">
          Vai ai report
        </Link>
      </div>

      <ContractsFilterTable rows={rows} editable={false} />
    </div>
  );
}
