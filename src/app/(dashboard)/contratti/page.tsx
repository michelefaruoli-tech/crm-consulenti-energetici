import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { ROLE_LABELS, type AppRole } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { ContractsFilterTable } from "@/components/contracts/contracts-filter-table";
import { PaginationNav } from "@/components/ui/pagination-nav";
import { ListSearchForm } from "@/components/ui/list-search-form";
import { StornoStatusFilters } from "@/components/ui/storno-status-filters";
import { toCollaboratorOption, toContractRows } from "@/lib/contract-row";
import { PAGE_SIZE, pageSkip, parsePage } from "@/lib/pagination";
import { contractTextSearchWhere } from "@/lib/list-search";
import {
  andStornoStatusWhere,
  buildStornoStatusWhere,
  formatStornoStatusFilters,
  loadDoppiaPosizioneContractIds,
  parseStornoStatusFilters,
  stornoFilterAllowsHistorical,
  stornoFilterHintLabels,
  stornoFilterNeedsDoppiaIds,
} from "@/lib/storno-filters";

export const dynamic = "force-dynamic";

/** Status ammessi via `?status=` (deep-link Dashboard P1.3). */
const CONTRATTI_STATUS_FILTER = new Set([
  "ERRORE_INVIO",
  "DOCUMENTAZIONE_INCOMPLETA",
  "IN_LAVORAZIONE",
  "DA_LAVORARE",
  "KO",
]);

export default async function ContrattiPage({
  searchParams,
}: {
  searchParams: Promise<{
    vista?: string;
    collab?: string;
    page?: string;
    q?: string;
    storno?: string;
    /** P1.3 — filtro stato contratto (whitelist). */
    status?: string;
  }>;
}) {
  const session = await requireSession();
  const {
    vista,
    collab,
    page: pageRaw,
    q,
    storno: stornoRaw,
    status: statusRaw,
  } = await searchParams;
  const page = parsePage(pageRaw);
  const now = new Date();
  const stornoIds = parseStornoStatusFilters(stornoRaw);
  const stornoParam = formatStornoStatusFilters(stornoIds) ?? undefined;
  const statusFilter = statusRaw?.trim().toUpperCase();
  const statusWhere: import("@/generated/prisma/client").Prisma.ContractWhereInput | undefined =
    statusFilter && CONTRATTI_STATUS_FILTER.has(statusFilter)
      ? statusFilter === "ERRORE_INVIO"
        ? {
            OR: [{ status: "ERRORE_INVIO" }, { emailStatus: "ERROR" }],
          }
        : {
            status: statusFilter as
              | "DOCUMENTAZIONE_INCOMPLETA"
              | "IN_LAVORAZIONE"
              | "DA_LAVORARE"
              | "KO",
          }
      : undefined;
  const canViewAll = hasPermission(session.role, "contracts.edit_all");
  const canChangeCollaborator = hasPermission(
    session.role,
    "contracts.change_collaborator_dashboard",
  );
  const canChangeStatus = hasPermission(session.role, "contracts.change_status");
  const mode =
    vista === "storico"
      ? "storico"
      : vista === "tutti"
        ? "tutti"
        : "attivi";

  const collabFilter =
    canViewAll && collab && collab !== "tutti" ? collab : undefined;

  const { contractVisibilityWhere } = await import("@/lib/user-scope");
  const visibility = await contractVisibilityWhere(session);
  const textSearch = contractTextSearchWhere(q);
  const allowHistorical =
    stornoFilterAllowsHistorical(stornoIds) || mode !== "attivi";

  const baseWhere = {
    deletedAt: null as null,
    ...visibility,
    ...(collabFilter ? { collaboratorId: collabFilter } : {}),
    ...(mode === "attivi" && !stornoFilterAllowsHistorical(stornoIds)
      ? { isHistorical: false as const }
      : mode === "storico"
        ? { isHistorical: true as const }
        : {}),
    ...(statusWhere ? statusWhere : {}),
    ...(textSearch ? { AND: [textSearch] } : {}),
  };

  const doppiaIds = stornoFilterNeedsDoppiaIds(stornoIds)
    ? await loadDoppiaPosizioneContractIds(prisma, {
        deletedAt: null,
        ...visibility,
        ...(collabFilter ? { collaboratorId: collabFilter } : {}),
      })
    : undefined;

  const stornoWhere = buildStornoStatusWhere(stornoIds, {
    now,
    doppiaIds,
  });
  const where = andStornoStatusWhere(baseWhere, stornoWhere);

  const chipWhere = {
    deletedAt: null as null,
    ...(mode === "attivi" && !stornoFilterAllowsHistorical(stornoIds)
      ? { isHistorical: false as const }
      : mode === "storico"
        ? { isHistorical: true as const }
        : {}),
  };

  const qParam = q?.trim() ? `&q=${encodeURIComponent(q.trim())}` : "";
  const stornoQs = stornoParam
    ? `&storno=${encodeURIComponent(stornoParam)}`
    : "";
  const vistaQ = mode === "tutti" ? "tutti" : mode;

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
              active: true,
              role: { in: ["COLLABORATORE", "COMMERCIALE", "AREA_MANAGER", "ADMIN", "SEGRETERIA"] },
            },
            select: { id: true, name: true, active: true, role: true },
            orderBy: { name: "asc" },
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

    const roleLabel = ROLE_LABELS[session.role as AppRole] ?? session.role;
    const queryBase = {
      vista: vistaQ,
      collab: collabFilter,
      q: q?.trim() || undefined,
      storno: stornoParam,
    };
    const stornoHint = stornoFilterHintLabels(stornoIds);

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Contratti</h1>
            <p className="text-slate-500">
              {total} contratti
              {q?.trim() ? ` trovati per «${q.trim()}»` : " in questa vista"}
              {stornoHint ? ` · ${stornoHint}` : ""}
              {" · "}
              ordinati per data inserimento (più recenti prima)
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
            {allowHistorical &&
            mode === "attivi" &&
            stornoFilterAllowsHistorical(stornoIds) ? (
              <p className="mt-1 text-xs text-slate-600">
                Filtro Storico attivo: inclusa anche l’archivio POD ricontrattualizzato.
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

        <ListSearchForm
          action="/contratti"
          q={q}
          hidden={{
            vista: vistaQ,
            collab: collabFilter,
            storno: stornoParam,
          }}
        />

        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href={`/contratti?vista=attivi${collabFilter ? `&collab=${collabFilter}` : ""}${qParam}${stornoQs}`}
            className={
              mode === "attivi"
                ? "rounded-lg bg-emerald-600 px-3 py-1.5 text-white"
                : "rounded-lg bg-slate-100 px-3 py-1.5 text-slate-700"
            }
          >
            Attivi
          </Link>
          <Link
            href={`/contratti?vista=storico${collabFilter ? `&collab=${collabFilter}` : ""}${qParam}${stornoQs}`}
            className={
              mode === "storico"
                ? "rounded-lg bg-emerald-600 px-3 py-1.5 text-white"
                : "rounded-lg bg-slate-100 px-3 py-1.5 text-slate-700"
            }
          >
            Storico
          </Link>
          <Link
            href={`/contratti?vista=tutti${collabFilter ? `&collab=${collabFilter}` : ""}${qParam}${stornoQs}`}
            className={
              mode === "tutti"
                ? "rounded-lg bg-emerald-600 px-3 py-1.5 text-white"
                : "rounded-lg bg-slate-100 px-3 py-1.5 text-slate-700"
            }
          >
            Tutti
          </Link>
        </div>

        <StornoStatusFilters
          path="/contratti"
          selected={stornoIds}
          queryBase={{
            vista: vistaQ,
            collab: collabFilter,
            q: q?.trim() || undefined,
          }}
        />

        {canViewAll ? (
          <div className="flex flex-wrap gap-2 text-sm">
            <Link
              href={`/contratti?vista=${vistaQ}${qParam}${stornoQs}`}
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
                href={`/contratti?vista=${vistaQ}&collab=${c.id}${qParam}${stornoQs}`}
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
          canChangeStatus={canChangeStatus && mode !== "storico"}
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
