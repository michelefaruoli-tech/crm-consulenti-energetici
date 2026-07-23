import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { canViewContract, hasPermission } from "@/lib/permissions";
import { clientDisplayName, formatDate, formatDateTime } from "@/lib/utils";
import { formatCurrency } from "@/lib/commission";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/form";
import { updateContractStatusAction, liquidateCommissionAction } from "@/lib/actions";
import { CONTRACT_STATUS_LABELS } from "@/lib/constants";
import { ContractStatus } from "@/generated/prisma/client";

export default async function ContrattoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;

  const contract = await prisma.contract.findUnique({
    where: { id },
    include: {
      client: true,
      supplier: true,
      service: true,
      collaborator: { select: { name: true, email: true } },
      commissionRule: true,
      commission: { include: { entries: { orderBy: { createdAt: "desc" } } } },
      statusHistory: {
        include: { changedBy: { select: { name: true } } },
        orderBy: { changedAt: "desc" },
      },
    },
  });

  if (!contract) notFound();
  if (!canViewContract(session.role, session.id, contract.collaboratorId)) {
    redirect("/contratti");
  }

  const canChangeStatus = hasPermission(session.role, "contracts.change_status");
  const canLiquidate = hasPermission(session.role, "commissions.view_all");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">Contratto</p>
          <h1 className="text-2xl font-bold text-slate-900">{contract.contractNumber}</h1>
          <div className="mt-2">
            <StatusBadge status={contract.status} />
          </div>
        </div>
        <Link href="/contratti">
          <Button variant="secondary">Torna all&apos;elenco</Button>
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-4 font-semibold text-slate-900">Dettagli pratica</h2>
          <dl className="grid gap-3 text-sm md:grid-cols-2">
            <div><dt className="text-slate-500">Cliente</dt><dd className="font-medium"><Link href={`/clienti/${contract.clientId}`} className="text-emerald-700 hover:underline">{clientDisplayName(contract.client)}</Link></dd></div>
            <div><dt className="text-slate-500">Fornitore</dt><dd className="font-medium">{contract.supplier.name}</dd></div>
            <div><dt className="text-slate-500">Servizio</dt><dd>{contract.service?.name ?? "—"}</dd></div>
            <div><dt className="text-slate-500">Collaboratore</dt><dd>{contract.collaborator.name}</dd></div>
            <div><dt className="text-slate-500">Inserimento</dt><dd>{formatDate(contract.insertionDate)}</dd></div>
            <div><dt className="text-slate-500">Attivazione</dt><dd>{formatDate(contract.activationDate)}</dd></div>
            <div><dt className="text-slate-500">Pagamento fornitore</dt><dd>{formatDate(contract.paymentDate)}</dd></div>
            <div><dt className="text-slate-500">Scadenza</dt><dd>{formatDate(contract.expiryDate)}</dd></div>
          </dl>
          {contract.notes ? <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">{contract.notes}</p> : null}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-900">Provvigione</h2>
          {contract.commission ? (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Prevista</dt><dd>{formatCurrency(contract.commission.expected)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Maturata</dt><dd>{formatCurrency(contract.commission.accrued)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Ricevuta</dt><dd>{formatCurrency(contract.commission.received)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Liquidata</dt><dd>{formatCurrency(contract.commission.paid)}</dd></div>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">Nessuna provvigione calcolata.</p>
          )}

          {canLiquidate && contract.commission && Number(contract.commission.received) > Number(contract.commission.paid) ? (
            <form action={liquidateCommissionAction} className="mt-4 space-y-3 border-t border-slate-100 pt-4">
              <input type="hidden" name="contractId" value={contract.id} />
              <Field label="Importo da liquidare">
                <input
                  type="number"
                  step="0.01"
                  name="amount"
                  defaultValue={Number(contract.commission.received) - Number(contract.commission.paid)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </Field>
              <Button type="submit" size="sm">Liquida provvigione</Button>
            </form>
          ) : null}
        </section>
      </div>

      {canChangeStatus ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-900">Aggiorna stato</h2>
          <form action={updateContractStatusAction} className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
            <input type="hidden" name="contractId" value={contract.id} />
            <Field label="Nuovo stato">
              <Select name="status" defaultValue={contract.status}>
                {Object.entries(CONTRACT_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Nota">
              <Textarea name="note" rows={1} />
            </Field>
            <div className="flex items-end">
              <Button type="submit">Aggiorna</Button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-semibold text-slate-900">Storico stati</h2>
        <ul className="space-y-3">
          {contract.statusHistory.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 text-sm last:border-0">
              <div>
                <StatusBadge status={entry.toStatus} />
                {entry.note ? <p className="mt-1 text-slate-500">{entry.note}</p> : null}
              </div>
              <div className="text-right text-slate-500">
                <p>{entry.changedBy.name}</p>
                <p>{formatDateTime(entry.changedAt)}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
