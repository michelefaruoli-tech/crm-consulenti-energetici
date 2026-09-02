import Link from "next/link";
import { Archive } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { formatCurrency } from "@/lib/commission";
import { ContractsFilterTable } from "@/components/contracts/contracts-filter-table";
import { ListSearchForm } from "@/components/ui/list-search-form";
import { toContractRows } from "@/lib/contract-row";
import { ArchiveImportForm } from "@/components/archive/archive-import-form";
import { ArchiveRestorePanel } from "@/components/archive/archive-restore-panel";
import { HeliosImportPanel } from "@/components/provvigioni/helios-import-panel";
import { contractTextSearchWhere } from "@/lib/list-search";
import { contractVisibilityWhere } from "@/lib/user-scope";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export default async function ArchivioPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireSession();
  const canManage = hasPermission(session.role, "contracts.edit_all");
  const visibility = await contractVisibilityWhere(session);

  const { q } = await searchParams;
  const textSearch = contractTextSearchWhere(q);

  const where: Prisma.ContractWhereInput = {
    isHistorical: true,
    AND: [
      visibility,
      ...(textSearch ? [textSearch] : []),
    ],
  };

  const [contracts, batches, totals, collaborators, archiveCount] =
    await Promise.all([
      prisma.contract.findMany({
        where,
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
            select: {
              type: true,
              companyName: true,
              firstName: true,
              lastName: true,
            },
          },
          supplier: { select: { id: true, name: true, stornoMonths: true } },
          collaborator: { select: { id: true, name: true } },
        },
        orderBy: { insertionDate: "desc" },
        take: 500,
      }),
      prisma.contract.groupBy({
        by: ["archiveLabel"],
        where,
        _count: { id: true },
      }),
      prisma.commission.aggregate({
        where: { contract: where },
        _sum: { expected: true, received: true, paid: true },
      }),
      canManage
        ? prisma.user.findMany({
            where: {
              active: true,
              role: {
                in: [
                  "COLLABORATORE",
                  "COMMERCIALE",
                  "AREA_MANAGER",
                  "ADMIN",
                  "SEGRETERIA",
                ],
              },
            },
            select: { id: true, name: true, email: true },
            orderBy: { name: "asc" },
          })
        : Promise.resolve([]),
      prisma.contract.count({ where }),
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
          {canManage
            ? "Contratti già pagati importati solo per report e consultazione. Non compaiono in Provvigioni attive."
            : "I tuoi contratti archiviati (consultazione). Vedi solo le pratiche a te assegnate."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">
            {canManage ? "Contratti in archivio" : "I tuoi contratti in archivio"}
          </p>
          <p className="mt-2 text-2xl font-bold">{archiveCount}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <p className="text-sm text-emerald-700">Totale gettoni storico</p>
          <p className="mt-2 text-2xl font-bold text-emerald-900">
            {formatCurrency(Number(totals._sum.expected ?? 0))}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Lotti</p>
          <ul className="mt-2 space-y-1 text-sm">
            {batches.length === 0 ? (
              <li className="text-slate-400">Nessuno ancora</li>
            ) : (
              batches.map((b) => (
                <li key={b.archiveLabel ?? "—"}>
                  <span className="font-medium">
                    {b.archiveLabel || "Senza nome"}
                  </span>
                  {" · "}
                  {b._count.id}
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      {canManage ? (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-2 font-semibold text-slate-900">
              Importa database già pagati
            </h2>
            <p className="mb-4 text-sm text-slate-500">
              Carica un Excel (.xlsx). Colonne riconosciute: Nome, Cognome,
              Ragione sociale, Telefono, Tipo, Fornitore, POD/PDR, Utility,
              Consumi, Data inserimento, Data ingresso fornitura, Mesi storno,
              Pagamento, Data pagamento, Agenzia, Gettone, Collaboratore, Nome
              offerta, Operazione, Durata mesi, Scadenza, Note. Di default i
              contratti finiscono in <strong>Provvigioni</strong> (attivi).
              Spunta «Nascondi da Provvigioni» solo per lotti già chiusi che
              vuoi solo in Archivio. Se rifai lo stesso POD, il contratto
              precedente viene archiviato in automatico.
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
              Qui carichi i file che ti manda Helios (es.
              Provvigioni_Aprile_2026_…). Segna in automatico i mesi ricorrenti
              come <strong>Incassato</strong> in Provvigioni (pagamento dal
              fornitore). Per pagare i collaboratori usa poi «Segna pagato» in
              Provvigioni.
            </p>
            <HeliosImportPanel embedded />
          </section>
        </>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">
          Contratti archiviati
        </h2>
        {canManage ? (
          <Link
            href="/report"
            className="text-sm text-emerald-700 hover:underline"
          >
            Vai ai report
          </Link>
        ) : (
          <Link
            href="/provvigioni"
            className="text-sm text-emerald-700 hover:underline"
          >
            Vai a Provvigioni
          </Link>
        )}
      </div>

      <ListSearchForm action="/archivio" q={q} />
      <p className="text-xs text-slate-500">
        {q?.trim()
          ? `${contracts.length} risultati (max 500) per «${q.trim()}».`
          : canManage
            ? "Mostra fino a 500 contratti. Usa la ricerca per trovare un cliente o POD."
            : "Vedi solo i tuoi contratti archiviati (max 500). Usa la ricerca per filtrare."}
      </p>

      {canManage ? <ArchiveRestorePanel rows={rows} /> : null}

      <ContractsFilterTable
        rows={rows}
        editable={false}
        canDelete={canManage}
      />
    </div>
  );
}
