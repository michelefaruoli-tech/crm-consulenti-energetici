import Link from "next/link";
import { redirect } from "next/navigation";
import { Archive } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { formatCurrency } from "@/lib/commission";
import { Button } from "@/components/ui/button";
import { ContractsFilterTable } from "@/components/contracts/contracts-filter-table";
import { toContractRows } from "@/lib/contract-row";
import { ArchiveImportForm } from "@/components/archive/archive-import-form";
import { HeliosImportPanel } from "@/components/provvigioni/helios-import-panel";

export const dynamic = "force-dynamic";

export default async function ArchivioPage() {
  const session = await requireSession();
  if (!hasPermission(session.role, "contracts.edit_all")) {
    redirect("/contratti");
  }

  const [contracts, batches, totals, collaborators] = await Promise.all([
    prisma.contract.findMany({
      where: { isHistorical: true },
      select: {
        id: true,
        clientId: true,
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
        archiveLabel: true,
        isHistorical: true,
        collaboratorId: true,
        recurrence: true,
        expiryDate: true,
        durationMonths: true,
        stornoEndDate: true,
        collectionDate: true,
        client: {
          select: { type: true, companyName: true, firstName: true, lastName: true },
        },
        supplier: { select: { id: true, name: true, stornoMonths: true } },
        collaborator: { select: { id: true, name: true } },
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
    prisma.user.findMany({
      where: {
        active: true,
        role: { in: ["COLLABORATORE", "COMMERCIALE", "ADMIN", "SEGRETERIA"] },
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const rows = toContractRows(contracts);

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
          Carica un Excel (.xlsx). Colonne riconosciute: Nome, Cognome, Ragione sociale,
          Telefono, Tipo, Fornitore, POD/PDR, Utility, Consumi, Data inserimento, Data
          ingresso fornitura, Mesi storno, Pagamento, Data pagamento, Agenzia, Gettone,
          Collaboratore, Nome offerta, Operazione, Durata mesi, Scadenza, Note. Di default i
          contratti finiscono in <strong>Provvigioni</strong> (attivi). Spunta «Nascondi da
          Provvigioni» solo per lotti già chiusi che vuoi solo in Archivio. Se rifai lo stesso
          POD, il contratto precedente viene archiviato in automatico.
        </p>
        <ArchiveImportForm
          collaborators={collaborators}
          defaultCollaboratorId={session.id}
        />
      </section>

      <section
        id="helios-import"
        className="rounded-xl border-2 border-sky-400 bg-sky-50 p-5 shadow-sm"
      >
        <h2 className="mb-1 font-semibold text-sky-950">
          Importa rendiconto Helios (mensile)
        </h2>
        <p className="mb-4 text-sm text-sky-900/80">
          Qui carichi i file che ti manda Helios (es. Provvigioni_Aprile_2026_…). Segna in
          automatico i mesi ricorrenti come <strong>pagati</strong> in Provvigioni, per POD.
          Puoi ripetere l’operazione ogni mese senza intasare la scheda Provvigioni.
        </p>
        <HeliosImportPanel embedded />
      </section>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Contratti archiviati</h2>
        <Link href="/report" className="text-sm text-emerald-700 hover:underline">
          Vai ai report
        </Link>
      </div>

      <ContractsFilterTable rows={rows} editable={false} canDelete />
    </div>
  );
}
