import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { ContractsFilterTable } from "@/components/contracts/contracts-filter-table";
import { toContractRow } from "@/lib/contract-row";

export const dynamic = "force-dynamic";

export default async function ContrattiPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string }>;
}) {
  const session = await requireSession();
  const { vista } = await searchParams;
  const canViewAll = hasPermission(session.role, "contracts.edit_all");
  const mode = vista === "storico" ? "storico" : vista === "tutti" ? "tutti" : "attivi";

  try {
    const contracts = await prisma.contract.findMany({
      where: {
        deletedAt: null,
        ...(canViewAll ? {} : { collaboratorId: session.id }),
        ...(mode === "attivi"
          ? { isHistorical: false }
          : mode === "storico"
            ? { isHistorical: true }
            : {}),
      },
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
    });

    const rows = contracts.map(toContractRow);

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Contratti</h1>
            <p className="text-slate-500">
              Modifica le celle in elenco · click sul nome per la scheda completa
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canViewAll ? (
              <Link href="/archivio">
                <Button variant="secondary">Archivio storico</Button>
              </Link>
            ) : null}
            {hasPermission(session.role, "contracts.create") ? (
              <Link href="/contratti/nuovo">
                <Button>Nuovo contratto</Button>
              </Link>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href="/contratti"
            className={
              mode === "attivi"
                ? "rounded-lg bg-emerald-600 px-3 py-1.5 text-white"
                : "rounded-lg bg-slate-100 px-3 py-1.5 text-slate-700"
            }
          >
            Attivi
          </Link>
          <Link
            href="/contratti?vista=storico"
            className={
              mode === "storico"
                ? "rounded-lg bg-emerald-600 px-3 py-1.5 text-white"
                : "rounded-lg bg-slate-100 px-3 py-1.5 text-slate-700"
            }
          >
            Storico
          </Link>
          <Link
            href="/contratti?vista=tutti"
            className={
              mode === "tutti"
                ? "rounded-lg bg-emerald-600 px-3 py-1.5 text-white"
                : "rounded-lg bg-slate-100 px-3 py-1.5 text-slate-700"
            }
          >
            Tutti
          </Link>
        </div>

        <ContractsFilterTable rows={rows} editable={mode !== "storico"} canDelete={canViewAll} />
      </div>
    );
  } catch (error) {
    console.error("Contratti error", error);
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
        <h1 className="text-lg font-semibold">Errore contratti</h1>
        <p className="mt-2 text-sm">
          {error instanceof Error ? error.message : "Errore sconosciuto"}
        </p>
      </div>
    );
  }
}
