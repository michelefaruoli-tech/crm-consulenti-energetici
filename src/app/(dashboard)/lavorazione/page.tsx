import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { DeleteRowButton } from "@/components/ui/delete-row-button";
import { InlineContractStatusSelect } from "@/components/contracts/inline-contract-status-select";
import { clientDisplayName, formatDate } from "@/lib/utils";
import { daysSince } from "@/lib/master-workflow";
import { formatRomeDateTime } from "@/lib/timezone";
import { redirect } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { contractVisibilityWhere } from "@/lib/user-scope";

export const dynamic = "force-dynamic";

export default async function LavorazionePage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    collaboratorId?: string;
    supplierId?: string;
    service?: string;
    /** lavorazione (default) | ko */
    vista?: string;
  }>;
}) {
  const session = await requireSession();
  const canSeeAll = hasPermission(session.role, "contracts.edit_all");
  const canWorkScoped = hasPermission(session.role, "contracts.work_scoped");
  const canChangeStatus = hasPermission(session.role, "contracts.change_status");
  if (!canSeeAll && !canWorkScoped && !hasPermission(session.role, "contracts.create")) {
    redirect("/");
  }

  const sp = await searchParams;
  const vistaKo = sp.vista === "ko";
  const visibility = await contractVisibilityWhere(session);

  const filterExtras: Prisma.ContractWhereInput = {
    ...visibility,
    ...(sp.collaboratorId ? { collaboratorId: sp.collaboratorId } : {}),
    ...(sp.supplierId ? { supplierId: sp.supplierId } : {}),
    ...(sp.service ? { utilityType: sp.service } : {}),
    ...(sp.q
      ? {
          OR: [
            { contractNumber: { contains: sp.q, mode: "insensitive" as const } },
            { podPdr: { contains: sp.q, mode: "insensitive" as const } },
            { pod: { contains: sp.q, mode: "insensitive" as const } },
            { pdr: { contains: sp.q, mode: "insensitive" as const } },
            {
              client: {
                OR: [
                  { firstName: { contains: sp.q, mode: "insensitive" as const } },
                  { lastName: { contains: sp.q, mode: "insensitive" as const } },
                  { companyName: { contains: sp.q, mode: "insensitive" as const } },
                ],
              },
            },
          ],
        }
      : {}),
  };

  /**
   * Lista «In lavorazione»: solo IN_LAVORAZIONE inviati al Master.
   * Lista «KO»: contratti in stato KO (stesso ambito utente/filtri).
   * Prima il contatore KO contava TUTTI i KO del DB ma la lista non li mostrava → sembrava un errore.
   */
  const where: Prisma.ContractWhereInput = vistaKo
    ? {
        deletedAt: null,
        status: "KO",
        ...filterExtras,
      }
    : {
        deletedAt: null,
        isHistorical: false,
        sendToMaster: true,
        assignedToMaster: true,
        status: "IN_LAVORAZIONE",
        ...filterExtras,
      };

  const scopeBase: Prisma.ContractWhereInput = {
    deletedAt: null,
    ...visibility,
  };

  const [contracts, collaborators, suppliers, countInLavorazione, countKo] =
    await Promise.all([
      prisma.contract.findMany({
        where,
        include: {
          client: true,
          collaborator: { select: { name: true } },
          supplier: { select: { name: true } },
        },
        orderBy: vistaKo
          ? [{ updatedAt: "desc" }]
          : [{ sentToMasterAt: "desc" }, { insertionDate: "desc" }],
        take: 200,
      }),
      canSeeAll
        ? prisma.user.findMany({
            where: { active: true },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          })
        : Promise.resolve([]),
      prisma.supplier.findMany({
        where: { active: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.contract.count({
        where: {
          ...scopeBase,
          isHistorical: false,
          sendToMaster: true,
          assignedToMaster: true,
          status: "IN_LAVORAZIONE",
        },
      }),
      prisma.contract.count({
        where: {
          ...scopeBase,
          status: "KO",
        },
      }),
    ]);

  const todayRome = new Date();
  todayRome.setHours(0, 0, 0, 0);
  const updatedToday = contracts.filter((c) => c.updatedAt >= todayRome).length;

  function hrefWith(extra: Record<string, string | undefined>) {
    const p = new URLSearchParams();
    if (sp.q) p.set("q", sp.q);
    if (sp.collaboratorId) p.set("collaboratorId", sp.collaboratorId);
    if (sp.supplierId) p.set("supplierId", sp.supplierId);
    if (sp.service) p.set("service", sp.service);
    for (const [k, v] of Object.entries(extra)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const s = p.toString();
    return s ? `/lavorazione?${s}` : "/lavorazione";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          {vistaKo ? "Contratti KO" : "Contratti in lavorazione"}
        </h1>
        <p className="text-slate-500">
          {vistaKo ? (
            <>
              Qui vedi i contratti in stato <strong>KO</strong> (non sono «in
              lavorazione»). Per tornare alle pratiche aperte usa la scheda{" "}
              <Link href={hrefWith({ vista: undefined })} className="text-emerald-700 underline">
                In lavorazione
              </Link>
              .
            </>
          ) : (
            <>
              Solo pratiche con stato «In lavorazione». I KO non compaiono qui:
              aprili dalla scheda rossa sotto. Pagamenti e attivazioni si gestiscono
              in{" "}
              <Link href="/provvigioni" className="text-emerald-700 underline">
                Provvigioni
              </Link>
              .
            </>
          )}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href={hrefWith({ vista: undefined })}
          className={
            !vistaKo
              ? "rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
              : "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
          }
        >
          In lavorazione ({countInLavorazione})
        </Link>
        <Link
          href={hrefWith({ vista: "ko" })}
          className={
            vistaKo
              ? "rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white"
              : "rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-950 hover:bg-red-100"
          }
        >
          KO ({countKo})
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Link
          href={hrefWith({ vista: undefined })}
          className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm hover:border-slate-300"
        >
          <p className="text-xs text-slate-500">In lavorazione (lista)</p>
          <p className="text-2xl font-semibold text-slate-900">{countInLavorazione}</p>
        </Link>
        <Link
          href={hrefWith({ vista: "ko" })}
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 shadow-sm hover:border-red-300"
          title="Apri l’elenco dei contratti KO"
        >
          <p className="text-xs text-red-800">KO (clicca per vedere l’elenco)</p>
          <p className="text-2xl font-semibold text-red-950">{countKo}</p>
          <p className="mt-1 text-[11px] text-red-800/80">
            Non sono «in lavorazione»: stato già KO
          </p>
        </Link>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm">
          <p className="text-xs text-emerald-800">
            Aggiornate oggi ({vistaKo ? "lista KO" : "lista lavorazione"})
          </p>
          <p className="text-2xl font-semibold text-emerald-900">{updatedToday}</p>
        </div>
      </div>

      <form className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-6">
        {vistaKo ? <input type="hidden" name="vista" value="ko" /> : null}
        <Field label="Ricerca">
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Pratica, cliente, POD..." />
        </Field>
        {canSeeAll ? (
          <Field label="Collaboratore">
            <Select name="collaboratorId" defaultValue={sp.collaboratorId ?? ""}>
              <option value="">Tutti</option>
              {collaborators.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Fornitore">
          <Select name="supplierId" defaultValue={sp.supplierId ?? ""}>
            <option value="">Tutti</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Servizio">
          <Select name="service" defaultValue={sp.service ?? ""}>
            <option value="">Tutti</option>
            <option value="LUCE">Luce</option>
            <option value="GAS">Gas</option>
            <option value="ALTRO">Altro</option>
          </Select>
        </Field>
        <div className="flex items-end">
          <Button type="submit">Filtra</Button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-3 py-2">Pratica</th>
              <th className="px-3 py-2">Invio</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Collaboratore</th>
              <th className="px-3 py-2">Servizio</th>
              <th className="px-3 py-2">Operazione</th>
              <th className="px-3 py-2">Fornitore</th>
              <th className="px-3 py-2">POD / PDR</th>
              <th className="px-3 py-2">Stato</th>
              <th className="px-3 py-2">Giorni</th>
              <th className="px-3 py-2">Aggiornato</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {contracts.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-3 py-8 text-center text-slate-500">
                  {vistaKo
                    ? "Nessun contratto KO con questi filtri."
                    : "Nessun contratto in lavorazione con questi filtri."}
                </td>
              </tr>
            ) : (
              contracts.map((c) => {
                const days = daysSince(c.sentToMasterAt ?? c.insertionDate);
                const stale = (days ?? 0) >= 3 && c.status === "IN_LAVORAZIONE";
                return (
                  <tr
                    key={c.id}
                    className={
                      vistaKo
                        ? "border-t border-red-100 bg-red-50/40"
                        : stale
                          ? "border-t border-amber-100 bg-amber-50/60"
                          : "border-t border-slate-100"
                    }
                  >
                    <td className="px-3 py-2 font-mono text-xs">{c.contractNumber}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {c.sentToMasterAt
                        ? formatRomeDateTime(c.sentToMasterAt)
                        : formatDate(c.insertionDate)}
                    </td>
                    <td className="px-3 py-2">{clientDisplayName(c.client)}</td>
                    <td className="px-3 py-2">{c.collaborator.name}</td>
                    <td className="px-3 py-2">{c.utilityType || "—"}</td>
                    <td className="px-3 py-2">{c.operationType || "—"}</td>
                    <td className="px-3 py-2">{c.supplier.name}</td>
                    <td className="px-3 py-2 text-sm">
                      {c.podPdr || c.pod || c.pdr || "—"}
                    </td>
                    <td className="px-3 py-2">
                      {canChangeStatus ? (
                        <InlineContractStatusSelect
                          contractId={c.id}
                          status={c.status}
                          mode="master"
                        />
                      ) : (
                        <StatusBadge status={c.status} />
                      )}
                      {c.emailStatus === "ERROR" || c.emailStatus === "SKIPPED_NO_SMTP" ? (
                        <p className="mt-1 text-[10px] text-red-600">Email: {c.emailStatus}</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {days != null ? (
                        <span className={stale ? "font-semibold text-amber-800" : ""}>
                          {days}g
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatRomeDateTime(c.updatedAt)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col items-end gap-1">
                        <Link href={`/lavorazione/${c.id}`}>
                          <Button type="button" size="sm" variant="secondary">
                            Apri scheda
                          </Button>
                        </Link>
                        <DeleteRowButton kind="contract" id={c.id} />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
