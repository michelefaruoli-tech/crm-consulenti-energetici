import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { clientDisplayName, formatDate, formatDateTime } from "@/lib/utils";
import { formatCurrency } from "@/lib/commission";
import { StatusBadge } from "@/components/ui/badge";
import { StornoBadgeList } from "@/components/ui/storno-badge";
import { resolveStornoBadges } from "@/lib/storno-badges";
import {
  markEarlyReswitchContracts,
  markLatestContractsByPod,
  normalizePodKey,
  resolveStornoInfo,
} from "@/lib/storno-status";
import { buildContractPodPeerRows } from "@/lib/contract-pod-peers";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import {
  updateContractStatusAction,
  updateContractCollaboratorAction,
  updateContractOperationAction,
  liquidateCommissionAction,
} from "@/lib/actions";
import { deleteContractAction } from "@/lib/delete-actions";
import { CONTRACT_STATUS_LABELS } from "@/lib/constants";
import {
  computeSupplyStartDate,
  formatItDate,
  OPERATION_TYPE_LABELS,
  normalizeOperationType,
} from "@/lib/supply-dates";
import { resolveUtilityDisplay } from "@/lib/utility-display";
import { ROLE_LABELS, type AppRole } from "@/lib/constants";
import { ContractCommissionTimeline } from "@/components/contracts/contract-commission-timeline";
import { ContractPodPeersSection } from "@/components/contracts/contract-pod-peers";
import { buildContractFinanceView } from "@/lib/contract-commission-finance";
import { isRecurring, recurrenceKindOf } from "@/lib/recurring";
import { ContractAttachmentsManager } from "@/components/contracts/contract-attachments-manager";
import { SendBackofficePanel } from "@/components/contracts/send-backoffice-panel";

export default async function ContrattoDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const { error: statusError } = await searchParams;

  const contract = await prisma.contract.findUnique({
    where: { id },
    include: {
      client: true,
      supplier: true,
      service: true,
      collaborator: { select: { id: true, name: true, email: true } },
      commission: {
        include: {
          entries: { orderBy: { createdAt: "desc" } },
        },
      },
      recurringMonths: {
        orderBy: { period: "desc" },
      },
      statusHistory: {
        include: { changedBy: { select: { name: true } } },
        orderBy: { changedAt: "desc" },
        take: 20,
      },
      documents: {
        where: { deletedAt: null },
        select: { id: true, filename: true, docType: true, size: true },
        orderBy: { uploadedAt: "desc" },
      },
    },
  });

  if (!contract) notFound();
  const {
    userCanAccessContract,
    loadVisibleCollaboratorOptions,
    contractVisibilityWhere,
  } = await import("@/lib/user-scope");
  if (!(await userCanAccessContract(session, contract))) {
    redirect("/contratti");
  }

  const canChangeStatus =
    hasPermission(session.role, "contracts.change_status") ||
    (hasPermission(session.role, "contracts.edit_own") &&
      contract.collaboratorId === session.id);
  // Scheda completa: solo Admin (Segreteria cambia dalla Dashboard)
  const canChangeCollaborator = hasPermission(
    session.role,
    "contracts.change_collaborator",
  );
  const canEditContract =
    hasPermission(session.role, "contracts.edit_all") ||
    contract.collaboratorId === session.id;
  const canLiquidate = hasPermission(session.role, "commissions.view_all");

  const rootId = contract.parentContractId || contract.id;
  const siblingRows = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      OR: [{ id: rootId }, { parentContractId: rootId }],
    },
    select: { id: true },
  });
  const siblingIds = siblingRows.map((r) => r.id);
  if (!siblingIds.includes(contract.id)) siblingIds.unshift(contract.id);
  const expected = Number(contract.commission?.expected ?? 0);
  const accrued = Number(contract.commission?.accrued ?? 0);
  const received = Number(contract.commission?.received ?? 0);
  const paid = Number(contract.commission?.paid ?? 0);
  const operationType = normalizeOperationType(contract.operationType);
  const supplyStart =
    contract.supplyStartDate ??
    computeSupplyStartDate(contract.insertionDate, operationType);

  const collaborators = canChangeCollaborator
    ? await loadVisibleCollaboratorOptions(session)
    : [];

  const [payoutRows, payoutAdjustments] = await Promise.all([
    prisma.payoutRow.findMany({
      where: { contractId: contract.id },
      select: {
        id: true,
        period: true,
        amount: true,
        recurringMonthId: true,
        matchStatus: true,
        appliedAt: true,
        note: true,
        batch: {
          select: {
            runId: true,
            source: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.payoutAdjustment.findMany({
      where: { contractId: contract.id },
      select: {
        id: true,
        kind: true,
        amount: true,
        note: true,
        voidedAt: true,
        createdAt: true,
        runId: true,
        run: { select: { period: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const finance = buildContractFinanceView({
    recurrenceKind:
      contract.recurrenceKind ?? recurrenceKindOf(contract.recurrence),
    contractStatus: contract.status,
    collectionDate: contract.collectionDate ?? contract.paymentDate,
    commission: contract.commission
      ? {
          expected: Number(contract.commission.expected),
          received: Number(contract.commission.received),
          paid: Number(contract.commission.paid),
          stornoAmount: Number(contract.commission.stornoAmount ?? 0),
          stornoDate: contract.commission.stornoDate,
        }
      : null,
    recurringMonths: contract.recurringMonths.map((m) => ({
      id: m.id,
      period: m.period,
      status: m.status,
      amount: Number(m.amount ?? 0),
      paidAt: m.paidAt,
      settledPeriod: m.settledPeriod,
      note: m.note,
    })),
    commissionEntries: (contract.commission?.entries ?? []).map((e) => ({
      id: e.id,
      type: e.type,
      amount: Number(e.amount),
      note: e.note,
      createdAt: e.createdAt,
    })),
    payoutRows: payoutRows.map((r) => ({
      id: r.id,
      period: r.period,
      amount: r.amount != null ? Number(r.amount) : null,
      recurringMonthId: r.recurringMonthId,
      matchStatus: r.matchStatus,
      appliedAt: r.appliedAt,
      note: r.note,
      runId: r.batch.runId,
      sourceName: r.batch.source.name,
    })),
    adjustments: payoutAdjustments.map((a) => ({
      id: a.id,
      kind: a.kind,
      amount: Number(a.amount),
      note: a.note,
      voidedAt: a.voidedAt,
      createdAt: a.createdAt,
      runId: a.runId,
      runPeriod: a.run.period,
    })),
  });

  const utility = resolveUtilityDisplay({
    utilityType: contract.utilityType,
    pod: contract.pod,
    pdr: contract.pdr,
    podPdr: contract.podPdr,
    serviceOther: contract.serviceOther,
  });

  const podKey = normalizePodKey(contract.podPdr || contract.pod || contract.pdr);
  const podValues = new Set<string>();
  for (const raw of [contract.podPdr, contract.pod, contract.pdr, podKey]) {
    const v = (raw ?? "").trim();
    if (!v) continue;
    podValues.add(v);
    if (podKey) podValues.add(podKey);
  }
  const podList = [...podValues];
  const podFieldOr =
    podList.length > 0
      ? [
          { podPdr: { in: podList, mode: "insensitive" as const } },
          { pod: { in: podList, mode: "insensitive" as const } },
          { pdr: { in: podList, mode: "insensitive" as const } },
        ]
      : [];

  // Badge latest/early: stesso perimetro di B1 (tutti i peer stesso POD, no scope)
  const badgePeers =
    podKey.length >= 6 && podFieldOr.length > 0
      ? await prisma.contract.findMany({
          where: {
            deletedAt: null,
            id: { not: contract.id },
            OR: podFieldOr,
          },
          select: {
            id: true,
            clientId: true,
            supplierId: true,
            podPdr: true,
            pod: true,
            pdr: true,
            supplyStartDate: true,
            insertionDate: true,
            createdAt: true,
            collectionDate: true,
            stornoEndDate: true,
            isHistorical: true,
            supplier: { select: { stornoMonths: true } },
          },
          take: 200,
        })
      : [];
  const samePodBadgePeers = badgePeers.filter(
    (p) => normalizePodKey(p.podPdr || p.pod || p.pdr) === podKey,
  );

  // Lista B3: solo contratti nel perimetro utente (cross-fornitore, POD normalizzato)
  const visibility = await contractVisibilityWhere(session);
  const listPeersRaw =
    podKey.length >= 6 && podFieldOr.length > 0
      ? await prisma.contract.findMany({
          where: {
            AND: [
              visibility,
              {
                deletedAt: null,
                OR: podFieldOr,
              },
            ],
          },
          select: {
            id: true,
            contractNumber: true,
            clientId: true,
            supplierId: true,
            status: true,
            operationType: true,
            podPdr: true,
            pod: true,
            pdr: true,
            utilityType: true,
            serviceOther: true,
            productName: true,
            supplyStartDate: true,
            insertionDate: true,
            createdAt: true,
            collectionDate: true,
            stornoEndDate: true,
            expiryDate: true,
            durationMonths: true,
            isHistorical: true,
            recurrence: true,
            client: {
              select: {
                type: true,
                firstName: true,
                lastName: true,
                companyName: true,
              },
            },
            supplier: { select: { name: true, stornoMonths: true } },
            service: { select: { name: true } },
            commission: { select: { stornoDate: true } },
          },
          take: 200,
        })
      : [];

  const peerListInputs = [
    {
      id: contract.id,
      contractNumber: contract.contractNumber,
      clientId: contract.clientId,
      supplierId: contract.supplierId,
      status: contract.status,
      operationType: contract.operationType,
      podPdr: contract.podPdr,
      pod: contract.pod,
      pdr: contract.pdr,
      utilityType: contract.utilityType,
      serviceOther: contract.serviceOther,
      productName: contract.productName,
      supplyStartDate: contract.supplyStartDate,
      insertionDate: contract.insertionDate,
      createdAt: contract.createdAt,
      collectionDate: contract.collectionDate,
      stornoEndDate: contract.stornoEndDate,
      expiryDate: contract.expiryDate,
      durationMonths: contract.durationMonths,
      isHistorical: contract.isHistorical,
      recurrence: contract.recurrence,
      client: contract.client,
      supplier: {
        name: contract.supplier.name,
        stornoMonths: contract.supplier.stornoMonths,
      },
      service: contract.service,
      commission: contract.commission
        ? { stornoDate: contract.commission.stornoDate }
        : null,
    },
    ...listPeersRaw.filter((p) => p.id !== contract.id),
  ];

  const podPeerRows = buildContractPodPeerRows(peerListInputs, {
    currentId: contract.id,
    podKey,
  });

  const peerBundle = [
    {
      id: contract.id,
      clientId: contract.clientId,
      supplierId: contract.supplierId,
      podPdr: contract.podPdr || contract.pod || contract.pdr,
      supplyStartDate: contract.supplyStartDate,
      insertionDate: contract.insertionDate,
      createdAt: contract.createdAt,
      collectionDate: contract.collectionDate,
      stornoMonths: contract.supplier.stornoMonths,
      stornoEndDate: contract.stornoEndDate,
    },
    ...samePodBadgePeers.map((p) => ({
      id: p.id,
      clientId: p.clientId,
      supplierId: p.supplierId,
      podPdr: p.podPdr || p.pod || p.pdr,
      supplyStartDate: p.supplyStartDate,
      insertionDate: p.insertionDate,
      createdAt: p.createdAt,
      collectionDate: p.collectionDate,
      stornoMonths: p.supplier.stornoMonths,
      stornoEndDate: p.stornoEndDate,
    })),
  ];
  const latestMap = markLatestContractsByPod(peerBundle);
  const earlyMap = markEarlyReswitchContracts(peerBundle);
  const stornoInfo = resolveStornoInfo({
    status: contract.status,
    recurrence: contract.recurrence,
    supplyStartDate: supplyStart,
    stornoMonths: contract.supplier.stornoMonths,
    stornoEndDate: contract.stornoEndDate,
    expiryDate: contract.expiryDate,
    durationMonths: contract.durationMonths,
    isLatestForPod: latestMap.get(contract.id) ?? true,
    collectionDate: contract.collectionDate,
    isEarlyReswitch: earlyMap.get(contract.id) ?? false,
  });
  const hasActivePodPeer = samePodBadgePeers.some((p) => !p.isHistorical);
  const stornoBadges = resolveStornoBadges({
    stornoKind: stornoInfo.kind,
    isHistorical: contract.isHistorical,
    isEarlyReswitch: earlyMap.get(contract.id) === true,
    isStornato:
      contract.status === "STORNATO" ||
      Boolean(contract.commission?.stornoDate),
    hasActivePodPeer,
  });

  return (
    <div className="space-y-6">
      {statusError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {statusError === "permesso"
            ? "Non hai i permessi per cambiare lo stato."
            : statusError === "stato_non_valido"
              ? "Stato non valido."
              : "Errore durante l'aggiornamento dello stato. Riprova."}
        </div>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">Pratica</p>
          <h1 className="text-2xl font-bold text-slate-900">
            {clientDisplayName(contract.client)}
          </h1>
          <p className="text-sm text-slate-500">{contract.supplier.name}</p>
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
            <p className="text-xs font-medium uppercase tracking-wide text-emerald-800">
              POD / PDR
            </p>
            {utility.techLines.length > 0 ? (
              utility.techLines.map((line) => (
                <p key={line} className="mt-1 text-base text-slate-900">
                  {line}
                </p>
              ))
            ) : (
              <p className="mt-1 text-base text-slate-900">Non indicato</p>
            )}
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-emerald-700">
              {utility.serviceLabel}
            </p>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={contract.status} />
            <StornoBadgeList badges={stornoBadges} />
          </div>
          {contract.isHistorical && contract.archiveLabel ? (
            <p className="mt-1 text-xs text-slate-600">
              Archivio: {contract.archiveLabel}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/clienti/${contract.clientId}?contratto=${contract.id}`}>
            <Button>Rivedi e completa (dati + allegati)</Button>
          </Link>
          <Link href="/contratti">
            <Button variant="secondary">Torna all&apos;elenco</Button>
          </Link>
          {hasPermission(session.role, "contracts.edit_all") ? (
            <form action={deleteContractAction}>
              <input type="hidden" name="contractId" value={contract.id} />
              <Button type="submit" variant="secondary">
                Elimina contratto
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-4 font-semibold text-slate-900">Dettagli pratica</h2>
          <dl className="grid gap-3 text-sm md:grid-cols-2">
            <div>
              <dt className="text-slate-500">Cliente</dt>
              <dd className="font-medium">
                <Link
                  href={`/clienti/${contract.clientId}`}
                  className="text-emerald-700 hover:underline"
                >
                  {clientDisplayName(contract.client)}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Fornitore</dt>
              <dd className="font-medium">{contract.supplier.name}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Tipo utenza</dt>
              <dd>{utility.serviceLabel}</dd>
            </div>
            <div>
              <dt className="text-slate-500">POD / PDR</dt>
              <dd className="text-sm text-slate-900">
                {utility.techLines.join(" · ") || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Prodotto</dt>
              <dd>{contract.productName || contract.service?.name || "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Collaboratore</dt>
              <dd>{contract.collaborator.name}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Inserimento</dt>
              <dd>{formatDate(contract.insertionDate)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Inizio fornitura</dt>
              <dd className="font-semibold text-emerald-800">{formatItDate(supplyStart)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Tipo operazione</dt>
              <dd>{OPERATION_TYPE_LABELS[operationType]}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Attivazione</dt>
              <dd>{formatDate(contract.activationDate)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Incasso</dt>
              <dd>{formatDate(contract.collectionDate ?? contract.paymentDate)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Scadenza</dt>
              <dd>{formatDate(contract.expiryDate)}</dd>
            </div>
          </dl>
          {contract.notes ? (
            <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">{contract.notes}</p>
          ) : null}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-900">Provvigione</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Attesa</dt>
              <dd>{formatCurrency(expected)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Maturata</dt>
              <dd>{formatCurrency(accrued)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Incassata</dt>
              <dd>{formatCurrency(received)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Liquidata</dt>
              <dd>{formatCurrency(paid)}</dd>
            </div>
          </dl>

          {canLiquidate && received > paid ? (
            <form action={liquidateCommissionAction} className="mt-4 space-y-3 border-t border-slate-100 pt-4">
              <input type="hidden" name="contractId" value={contract.id} />
              <Field label="Importo da liquidare">
                <input
                  type="number"
                  step="0.01"
                  name="amount"
                  defaultValue={received - paid}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </Field>
              <Button type="submit" size="sm">
                Liquida provvigione
              </Button>
            </form>
          ) : null}
        </section>
      </div>

      <ContractPodPeersSection podKey={podKey} rows={podPeerRows} />

      <ContractCommissionTimeline
        totals={finance.totals}
        timeline={finance.timeline}
        adjustments={finance.adjustments}
      />

      {canEditContract ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-2 font-semibold text-slate-900">Tipo operazione e inizio fornitura</h2>
          <p className="mb-4 text-xs text-slate-500">
            Switch: se inserito entro il giorno 9 → 1° del mese successivo, altrimenti 1° di due
            mesi dopo. Voltura/Attivazione: circa +10 giorni dall&apos;inserimento.
          </p>
          <form
            action={updateContractOperationAction}
            className="grid gap-4 md:grid-cols-[1fr_auto]"
          >
            <input type="hidden" name="contractId" value={contract.id} />
            <Field label="Operazione">
              <Select name="operationType" defaultValue={operationType}>
                {Object.entries(OPERATION_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <Button type="submit">Ricalcola data</Button>
            </div>
          </form>
        </section>
      ) : null}

      {canChangeCollaborator ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-900">Cambia collaboratore</h2>
          <p className="mb-3 text-xs text-slate-500">
            Solo amministratore. La modifica viene registrata nello storico.
          </p>
          <form
            action={updateContractCollaboratorAction}
            className="grid gap-4 md:grid-cols-[1fr_1fr_auto]"
          >
            <input type="hidden" name="contractId" value={contract.id} />
            <Field label="Assegna a">
              <Select name="collaboratorId" defaultValue={contract.collaboratorId}>
                {collaborators.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                    {user.role
                      ? ` · ${ROLE_LABELS[user.role as AppRole] ?? user.role}`
                      : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Motivazione (facoltativa)">
              <Input name="reason" placeholder="Motivo del cambio" />
            </Field>
            <div className="flex items-end">
              <Button type="submit">Salva collaboratore</Button>
            </div>
          </form>
        </section>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-2 font-semibold text-slate-900">Collaboratore</h2>
          <p className="text-sm text-slate-700">{contract.collaborator.name}</p>
          <p className="mt-1 text-xs text-slate-500">
            Solo l&apos;amministratore può cambiare il collaboratore da questa scheda.
          </p>
        </section>
      )}

      {canChangeStatus ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-900">Aggiorna stato</h2>
          {isRecurring(contract.recurrence) ? (
            <p className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              Con lo stato <strong>Chiuso</strong>, il mese della chiusura resta valido;
              dal mese successivo non maturano più provvigioni ricorrenti.
            </p>
          ) : null}
          <form
            action={updateContractStatusAction}
            className="grid gap-4 md:grid-cols-[1fr_1fr_auto]"
          >
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

      {canEditContract ? (
        <div className="space-y-4">
          <ContractAttachmentsManager
            contractId={contract.id}
            documents={contract.documents}
            canUpload
          />
          <SendBackofficePanel
            contractIds={siblingIds}
            supplierName={contract.supplier.name}
            attachmentCount={contract.documents.length}
            alreadyQueued={Boolean(contract.sendToMaster || contract.assignedToMaster)}
          />
        </div>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-semibold text-slate-900">Storico stati</h2>
        <ul className="space-y-3">
          {contract.statusHistory.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 text-sm last:border-0"
            >
              <div>
                <StatusBadge status={entry.toStatus} />
                {entry.note ? <p className="mt-1 text-slate-500">{entry.note}</p> : null}
              </div>
              <div className="text-right text-slate-500">
                <p>{entry.changedBy?.name ?? "—"}</p>
                <p>{formatDateTime(entry.changedAt)}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
