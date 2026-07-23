import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { ContractsFilterTable } from "@/components/contracts/contracts-filter-table";
import { toContractRow } from "@/lib/contract-row";

export const dynamic = "force-dynamic";

export default async function ContrattiPage() {
  const session = await requireSession();
  const canViewAll = hasPermission(session.role, "contracts.edit_all");

  try {
    const contracts = await prisma.contract.findMany({
      where: canViewAll ? {} : { collaboratorId: session.id },
      select: {
        id: true,
        status: true,
        insertionDate: true,
        podPdr: true,
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
              Clicca sul nome cliente per aprire la pratica · filtra con ▾
            </p>
          </div>
          {hasPermission(session.role, "contracts.create") ? (
            <Link href="/contratti/nuovo">
              <Button>Nuovo contratto</Button>
            </Link>
          ) : null}
        </div>

        <ContractsFilterTable rows={rows} />
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
