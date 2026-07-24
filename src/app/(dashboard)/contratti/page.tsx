import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { ContractsFilterTable } from "@/components/contracts/contracts-filter-table";
import { toCollaboratorOption, toContractRows } from "@/lib/contract-row";

export const dynamic = "force-dynamic";

export default async function ContrattiPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string }>;
}) {
  const session = await requireSession();
  const { vista } = await searchParams;
  const canViewAll = hasPermission(session.role, "contracts.edit_all");
  const canChangeCollaborator = hasPermission(
    session.role,
    "contracts.change_collaborator_dashboard",
  );
  const mode =
    vista === "storico"
      ? "storico"
      : vista === "attivi"
        ? "attivi"
        : vista === "tutti"
          ? "tutti"
          : canViewAll
            ? "tutti"
            : "attivi";

  try {
    const [contracts, collaboratorOptions] = await Promise.all([
      prisma.contract.findMany({
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
          client: {
            select: { type: true, companyName: true, firstName: true, lastName: true },
          },
          supplier: { select: { id: true, name: true, stornoMonths: true } },
          collaborator: { select: { id: true, name: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      canChangeCollaborator
        ? prisma.user.findMany({
            where: {
              role: { in: ["COLLABORATORE", "COMMERCIALE", "ADMIN", "SEGRETERIA"] },
            },
            select: { id: true, name: true, active: true, role: true },
            orderBy: [{ active: "desc" }, { name: "asc" }],
          })
        : Promise.resolve([]),
    ]);

    const rows = toContractRows(contracts);
    const collaborators = collaboratorOptions.map(toCollaboratorOption);

    const byCollab = new Map<string, number>();
    for (const c of contracts) {
      const name = c.collaborator.name;
      byCollab.set(name, (byCollab.get(name) ?? 0) + 1);
    }
    const collabSummary = [...byCollab.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `${name}: ${n}`)
      .join(" · ");

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Contratti</h1>
            <p className="text-slate-500">
              {contracts.length} contratti in questa vista
              {canViewAll && collabSummary ? ` · ${collabSummary}` : ""}
            </p>
            {canViewAll && mode === "attivi" ? (
              <p className="mt-1 text-xs text-amber-800">
                Stai guardando solo «Attivi» (senza storico). Per vedere anche lo storico apri{" "}
                <Link href="/contratti?vista=tutti" className="font-medium underline">
                  Tutti
                </Link>
                . I conteggi per collaboratore sopra devono mostrare Michele, Laforgia, Fagiano,
                ecc.
              </p>
            ) : null}
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
            href="/contratti?vista=attivi"
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

        <ContractsFilterTable
          rows={rows}
          editable={mode !== "storico"}
          canDelete
          canChangeCollaborator={canChangeCollaborator && mode !== "storico"}
          collaborators={collaborators}
        />
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
