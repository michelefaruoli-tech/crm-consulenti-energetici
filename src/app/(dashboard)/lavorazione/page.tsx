import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { clientDisplayName, formatDate } from "@/lib/utils";
import { daysSince } from "@/lib/master-workflow";
import { formatRomeDateTime } from "@/lib/timezone";
import { MASTER_WORKFLOW_STATUSES, MASTER_STATUS_LABELS } from "@/lib/master-workflow";
import { redirect } from "next/navigation";

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
  }>;
}) {
  const session = await requireSession();
  const canSeeAll = hasPermission(session.role, "contracts.edit_all");
  if (!canSeeAll && !hasPermission(session.role, "contracts.create")) {
    redirect("/");
  }

  const sp = await searchParams;
  const where = {
    deletedAt: null,
    isHistorical: false,
    sendToMaster: true,
    assignedToMaster: true,
    ...(canSeeAll ? {} : { collaboratorId: session.id }),
    ...(sp.status ? { status: sp.status as never } : {}),
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

  const [contracts, collaborators, suppliers, statusCounts] = await Promise.all([
    prisma.contract.findMany({
      where,
      include: {
        client: true,
        collaborator: { select: { name: true } },
        supplier: { select: { name: true } },
      },
      orderBy: [{ sentToMasterAt: "desc" }, { insertionDate: "desc" }],
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
    prisma.contract.groupBy({
      by: ["status"],
      where: {
        deletedAt: null,
        sendToMaster: true,
        assignedToMaster: true,
        ...(canSeeAll ? {} : { collaboratorId: session.id }),
      },
      _count: { id: true },
    }),
  ]);

  const todayRome = new Date();
  todayRome.setHours(0, 0, 0, 0);
  const updatedToday = contracts.filter((c) => c.updatedAt >= todayRome).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Contratti in lavorazione</h1>
        <p className="text-slate-500">
          Solo pratiche inviate al Master · non include bozze o registrazioni interne
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {MASTER_WORKFLOW_STATUSES.map((st) => {
          const count =
            statusCounts.find((s) => s.status === st)?._count.id ?? 0;
          return (
            <div
              key={st}
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
            >
              <p className="text-xs text-slate-500">{MASTER_STATUS_LABELS[st]}</p>
              <p className="text-2xl font-semibold text-slate-900">{count}</p>
            </div>
          );
        })}
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm">
          <p className="text-xs text-emerald-800">Aggiornate oggi</p>
          <p className="text-2xl font-semibold text-emerald-900">{updatedToday}</p>
        </div>
      </div>

      <form className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-6">
        <Field label="Ricerca">
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Pratica, cliente, POD..." />
        </Field>
        <Field label="Stato">
          <Select name="status" defaultValue={sp.status ?? ""}>
            <option value="">Tutti</option>
            {MASTER_WORKFLOW_STATUSES.map((st) => (
              <option key={st} value={st}>
                {MASTER_STATUS_LABELS[st]}
              </option>
            ))}
          </Select>
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
            <option value="TELEFONIA">Telefonia</option>
            <option value="POS">POS</option>
            <option value="FOTOVOLTAICO">Fotovoltaico</option>
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
                  Nessun contratto inviato al Master con questi filtri.
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
                      stale
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
                      <StatusBadge status={c.status} />
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
                      <Link href={`/lavorazione/${c.id}`}>
                        <Button type="button" size="sm" variant="secondary">
                          Apri scheda
                        </Button>
                      </Link>
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
