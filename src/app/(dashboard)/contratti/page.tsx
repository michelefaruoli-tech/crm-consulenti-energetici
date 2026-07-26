import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { ROLE_LABELS, type AppRole } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { ContractsFilterTable } from "@/components/contracts/contracts-filter-table";
import { PaginationNav } from "@/components/ui/pagination-nav";
import { toCollaboratorOption, toContractRows } from "@/lib/contract-row";
import { PAGE_SIZE, pageSkip, parsePage } from "@/lib/pagination";

export const dynamic = "force-dynamic";

export default async function ContrattiPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; collab?: string; page?: string }>;
}) {
  const session = await requireSession();
  const { vista, collab, page: pageRaw } = await searchParams;
  const page = parsePage(pageRaw);
  const canViewAll = hasPermission(session.role, "contracts.edit_all");
  const canChangeCollaborator = hasPermission(
    session.role,
    "contracts.change_collaborator_dashboard",
  );
  const mode =
    vista === "storico"
      ? "storico"
      : vista === "tutti"
        ? "tutti"
        : "attivi";

  const collabFilter =
    canViewAll && collab && collab !== "tutti" ? collab : undefined;

  const where = {
    deletedAt: null as null,
    ...(canViewAll
      ? collabFilter
        ? { collaboratorId: collabFilter }
        : {}
      : { collaboratorId: session.id }),
    ...(mode === "attivi"
      ? { isHistorical: false as const }
      : mode === "storico"
        ? { isHistorical: true as const }
        : {}),
  };

  const chipWhere = {
    deletedAt: null as null,
    ...(mode === "attivi"
      ? { isHistorical: false as const }
      : mode === "storico"
        ? { isHistorical: true as const }
        : {}),
  };

  try {
    const [total, contracts, collaboratorOptions, collabGroups] = await Promise.all([
      prisma.contract.count({ where }),
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
            select: { type: true, companyName: true, firstName: true, lastName: true },
          },
          supplier: { select: { id: true, name: true, stornoMonths: true } },
          collaborator: { select: { id: true, name: true } },
        },
        orderBy: [{ insertionDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        skip: pageSkip(page),
        take: PAGE_SIZE,
      }),
      canChangeCollaborator || canViewAll
        ? prisma.user.findMany({
            where: {
              role: { in: ["COLLABORATORE", "COMMERCIALE", "ADMIN", "SEGRETERIA"] },
            },
            select: { id: true, name: true, active: true, role: true },
            orderBy: [{ active: "desc" }, { name: "asc" }],
          })
        : Promise.resolve([]),
      canViewAll
        ? prisma.contract.groupBy({
            by: ["collaboratorId"],
            where: chipWhere,
            _count: { id: true },
          })
        : Promise.resolve([]),
    ]);

    const rows = toContractRows(contracts);
    const collaborators = collaboratorOptions.map(toCollaboratorOption);

    const nameById = Object.fromEntries(collaboratorOptions.map((u) => [u.id, u.name]));
    const allCollabCounts = collabGroups
      .map((g) => ({
        id: g.collaboratorId,
        name: nameById[g.collaboratorId] ?? g.collaboratorId,
        n: g._count.id,
      }))
      .sort((a, b) => b.n - a.n);

    const vistaQ = mode === "tutti" ? "tutti" : mode;
    const roleLabel = ROLE_LABELS[session.role as AppRole] ?? session.role;
    const queryBase = {
      vista: vistaQ,
      collab: collabFilter,
    };

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Contratti</h1>
            <p className="text-slate-500">
              {total} contratti in questa vista · ordinati per data inserimento (più recenti
              prima)
              {canViewAll
                ? ` · accesso ${roleLabel} (${session.email})`
                : ` · solo i tuoi`}
            </p>
            {!canViewAll ? (
              <p className="mt-1 text-xs text-amber-800">
                Il tuo ruolo ({roleLabel}) vede solo i contratti assegnati a te. Serve ruolo
                Admin o Segreteria per vedere tutti.
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
            href={`/contratti?vista=attivi${collabFilter ? `&collab=${collabFilter}` : ""}`}
            className={
              mode === "attivi"
                ? "rounded-lg bg-emerald-600 px-3 py-1.5 text-white"
                : "rounded-lg bg-slate-100 px-3 py-1.5 text-slate-700"
            }
          >
            Attivi
          </Link>
          <Link
            href={`/contratti?vista=storico${collabFilter ? `&collab=${collabFilter}` : ""}`}
            className={
              mode === "storico"
                ? "rounded-lg bg-emerald-600 px-3 py-1.5 text-white"
                : "rounded-lg bg-slate-100 px-3 py-1.5 text-slate-700"
            }
          >
            Storico
          </Link>
          <Link
            href={`/contratti?vista=tutti${collabFilter ? `&collab=${collabFilter}` : ""}`}
            className={
              mode === "tutti"
                ? "rounded-lg bg-emerald-600 px-3 py-1.5 text-white"
                : "rounded-lg bg-slate-100 px-3 py-1.5 text-slate-700"
            }
          >
            Tutti
          </Link>
        </div>

        {canViewAll ? (
          <div className="flex flex-wrap gap-2 text-sm">
            <Link
              href={`/contratti?vista=${vistaQ}`}
              className={
                !collabFilter
                  ? "rounded-lg bg-slate-800 px-3 py-1.5 text-white"
                  : "rounded-lg bg-slate-100 px-3 py-1.5 text-slate-700"
              }
            >
              Tutti i collaboratori ({allCollabCounts.reduce((s, c) => s + c.n, 0)})
            </Link>
            {allCollabCounts.map((c) => (
              <Link
                key={c.id}
                href={`/contratti?vista=${vistaQ}&collab=${c.id}`}
                className={
                  collabFilter === c.id
                    ? "rounded-lg bg-slate-800 px-3 py-1.5 text-white"
                    : "rounded-lg bg-slate-100 px-3 py-1.5 text-slate-700"
                }
              >
                {c.name} ({c.n})
              </Link>
            ))}
          </div>
        ) : null}

        <PaginationNav path="/contratti" page={page} total={total} query={queryBase} />

        <ContractsFilterTable
          rows={rows}
          editable={mode !== "storico"}
          canDelete
          canChangeCollaborator={canChangeCollaborator && mode !== "storico"}
          collaborators={collaborators}
        />

        <PaginationNav path="/contratti" page={page} total={total} query={queryBase} />
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
