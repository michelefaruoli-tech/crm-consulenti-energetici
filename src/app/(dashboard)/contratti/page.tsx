import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import {
  ContractsFilterTable,
  toContractRow,
} from "@/components/contracts/contracts-filter-table";

export default async function ContrattiPage() {
  const session = await requireSession();
  const canViewAll = hasPermission(session.role, "contracts.edit_all");

  const contracts = await prisma.contract.findMany({
    where: canViewAll ? {} : { collaboratorId: session.id },
    include: {
      client: true,
      supplier: true,
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
            Filtra per cliente, fornitore, stato, data e collaboratore
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
}
