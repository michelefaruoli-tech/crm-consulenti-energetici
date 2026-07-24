import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { canViewContract, hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { clientDisplayName } from "@/lib/utils";
import { MASTER_STATUS_LABELS } from "@/lib/master-workflow";
import { formatRomeDateTime } from "@/lib/timezone";
import {
  resendMasterEmailAction,
  updateMasterWorkflowAction,
} from "@/lib/master-actions";
import { MasterStatusForm } from "@/components/contracts/master-status-form";
import { LavorazioneEditForm } from "@/components/contracts/lavorazione-edit-form";
import { DeleteRowButton } from "@/components/ui/delete-row-button";

export const dynamic = "force-dynamic";

export default async function LavorazioneSchedaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const sp = await searchParams;

  const contract = await prisma.contract.findUnique({
    where: { id },
    include: {
      client: true,
      supplier: true,
      collaborator: { select: { id: true, name: true, email: true } },
      createdBy: { select: { name: true } },
      documents: { orderBy: { uploadedAt: "desc" } },
      statusHistory: {
        include: { changedBy: { select: { name: true } } },
        orderBy: { changedAt: "desc" },
        take: 50,
      },
      emailLogs: { orderBy: { createdAt: "desc" }, take: 10 },
      commission: true,
    },
  });

  if (!contract || contract.deletedAt) notFound();
  if (!canViewContract(session.role, session.id, contract.collaboratorId)) {
    redirect("/lavorazione");
  }
  if (!contract.sendToMaster || !contract.assignedToMaster) {
    redirect(`/contratti/${contract.id}`);
  }

  const isAdmin = hasPermission(session.role, "contracts.edit_all");
  const canEdit =
    isAdmin ||
    (hasPermission(session.role, "contracts.edit_own") &&
      session.id === contract.collaboratorId);

  const editData = {
    id: contract.id,
    utilityType: contract.utilityType,
    serviceOther: contract.serviceOther,
    operationType: contract.operationType,
    operationOther: contract.operationOther,
    pod: contract.pod,
    pdr: contract.pdr,
    podPdr: contract.podPdr,
    productName: contract.productName,
    offerCode: contract.offerCode,
    contractKind: contract.contractKind,
    priceType: contract.priceType,
    pricePerKwh: contract.pricePerKwh != null ? String(contract.pricePerKwh) : null,
    pricePerSmc: contract.pricePerSmc != null ? String(contract.pricePerSmc) : null,
    pcv: contract.pcv != null ? String(contract.pcv) : null,
    spread: contract.spread != null ? String(contract.spread) : null,
    monthlyFee: contract.monthlyFee != null ? String(contract.monthlyFee) : null,
    powerKw: contract.powerKw != null ? String(contract.powerKw) : null,
    annualKwh: contract.annualKwh != null ? String(contract.annualKwh) : null,
    annualSmc: contract.annualSmc != null ? String(contract.annualSmc) : null,
    paymentMethod: contract.paymentMethod,
    contractIban: contract.contractIban,
    ibanHolder: contract.ibanHolder,
    supplyStreet: contract.supplyStreet,
    supplyStreetNumber: contract.supplyStreetNumber,
    supplyZipCode: contract.supplyZipCode,
    supplyCity: contract.supplyCity,
    supplyProvince: contract.supplyProvince,
    supplyRegion: contract.supplyRegion,
    notes: contract.notes,
    masterNotes: contract.masterNotes,
    workNotes: contract.workNotes,
    durationMonths: contract.durationMonths,
    client: {
      firstName: contract.client.firstName,
      lastName: contract.client.lastName,
      companyName: contract.client.companyName,
      fiscalCode: contract.client.fiscalCode,
      vatNumber: contract.client.vatNumber,
      phone: contract.client.phone,
      email: contract.client.email,
      pec: contract.client.pec,
      iban: contract.client.iban,
      street: contract.client.street,
      streetNumber: contract.client.streetNumber,
      zipCode: contract.client.zipCode,
      city: contract.client.city,
      province: contract.client.province,
      region: contract.client.region,
    },
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">Scheda operativa Master</p>
          <h1 className="text-2xl font-bold text-slate-900">
            {contract.contractNumber}
          </h1>
          <p className="text-slate-600">{clientDisplayName(contract.client)}</p>
          <div className="mt-2">
            <StatusBadge status={contract.status} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/lavorazione">
            <Button variant="secondary">Torna alla lista</Button>
          </Link>
          <Link href={`/contratti/${contract.id}`}>
            <Button variant="secondary">Scheda contratto</Button>
          </Link>
          <DeleteRowButton kind="contract" id={contract.id} />
        </div>
      </div>

      {sp.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {decodeURIComponent(sp.error)}
        </div>
      ) : null}
      {sp.ok ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {sp.ok === "email"
            ? "Contratto creato e inviato al Master."
            : "Aggiornamento salvato."}
        </div>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-semibold text-slate-900">Dati pratica</h2>
        <dl className="grid gap-3 text-sm md:grid-cols-2">
          <div>
            <dt className="text-slate-500">Numero contratto</dt>
            <dd className="font-medium">{contract.contractNumber}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Stato</dt>
            <dd>
              <StatusBadge status={contract.status} />
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Data creazione</dt>
            <dd>{formatRomeDateTime(contract.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Invio al Master</dt>
            <dd>
              {contract.sentToMasterAt
                ? formatRomeDateTime(contract.sentToMasterAt)
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Collaboratore</dt>
            <dd>{contract.collaborator.name}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Creatore</dt>
            <dd>{contract.createdBy?.name || "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Ultima modifica</dt>
            <dd>{formatRomeDateTime(contract.updatedAt)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Stato email</dt>
            <dd>
              {contract.emailStatus || "—"}
              {contract.emailAttempts ? ` · tentativi ${contract.emailAttempts}` : ""}
              {contract.emailLastError ? (
                <span className="mt-1 block text-xs text-red-600">
                  {contract.emailLastError}
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Fornitore</dt>
            <dd>{contract.supplier.name}</dd>
          </div>
        </dl>

        {contract.documents.length > 0 ? (
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium text-slate-700">Allegati</p>
            <ul className="space-y-1 text-sm">
              {contract.documents.map((d) => (
                <li key={d.id} className="flex justify-between rounded bg-slate-50 px-2 py-1">
                  <span>
                    {d.filename}
                    {d.docType ? ` · ${d.docType}` : ""}
                    {d.size ? ` · ${Math.round(d.size / 1024)} KB` : ""}
                  </span>
                  <Link
                    className="text-emerald-700 underline"
                    href={`/api/documents/${d.id}`}
                  >
                    Scarica
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">Nessun allegato</p>
        )}
      </section>

      <LavorazioneEditForm data={editData} canEdit={canEdit} />

      {isAdmin ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-900">Area operativa</h2>
          <p className="mb-3 text-sm text-slate-500">
            Stato attuale:{" "}
            <strong>
              {MASTER_STATUS_LABELS[
                contract.status as keyof typeof MASTER_STATUS_LABELS
              ] ?? contract.status}
            </strong>
          </p>
          <MasterStatusForm
            contractId={contract.id}
            currentStatus={contract.status}
            action={updateMasterWorkflowAction}
          />
        </section>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm text-sm text-slate-600">
          Solo l&apos;amministratore/Master può cambiare lo stato operativo. Puoi
          consultare e modificare i dati sopra, e vedere lo storico sotto.
        </section>
      )}

      {isAdmin ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-slate-900">Reinvia al Master</h2>
          {contract.emailStatus === "SENT" && contract.sentToMasterAt ? (
            <p className="mb-3 text-sm text-slate-600">
              Ultimo invio: {formatRomeDateTime(contract.sentToMasterAt)}. Tentativi:{" "}
              {contract.emailAttempts}.
            </p>
          ) : (
            <p className="mb-3 text-sm text-amber-800">
              Email non inviata correttamente ({contract.emailStatus || "n/d"}).
              Puoi riprovare.
            </p>
          )}
          <form action={resendMasterEmailAction} className="grid gap-3 md:grid-cols-[1fr_auto]">
            <input type="hidden" name="contractId" value={contract.id} />
            <Field label="Motivo del reinvio *">
              <Input name="resendReason" required placeholder="Es. SMTP ripristinato / dati aggiornati" />
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="secondary">
                Reinvia al Master
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-semibold text-slate-900">Storico modifiche</h2>
        <ul className="space-y-3">
          {contract.statusHistory.map((h) => (
            <li
              key={h.id}
              className="border-b border-slate-100 pb-3 text-sm last:border-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <StatusBadge status={h.toStatus} />
                  {h.fromStatus ? (
                    <span className="text-xs text-slate-500">da {h.fromStatus}</span>
                  ) : null}
                </div>
                <div className="text-right text-slate-500">
                  <p>{h.changedBy?.name}</p>
                  <p>{formatRomeDateTime(h.changedAt)}</p>
                </div>
              </div>
              {h.changeReason ? (
                <p className="mt-1 text-slate-600">{h.changeReason}</p>
              ) : null}
              {h.note ? <p className="mt-1 text-slate-500">{h.note}</p> : null}
              {h.koReason ? (
                <p className="mt-1 text-red-700">KO: {h.koReason}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {contract.emailLogs.length > 0 ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-slate-900">Log email</h2>
          <ul className="space-y-2 text-sm">
            {contract.emailLogs.map((e) => (
              <li key={e.id} className="flex justify-between gap-2 border-b border-slate-50 pb-2">
                <span>
                  {e.emailType} · {e.status} · {e.subject.slice(0, 60)}
                  {e.error ? (
                    <span className="block text-xs text-red-600">{e.error}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-slate-500">
                  {formatRomeDateTime(e.sentAt ?? e.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
