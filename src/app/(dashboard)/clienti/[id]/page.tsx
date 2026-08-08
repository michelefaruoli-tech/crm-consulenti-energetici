import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { clientDisplayName, formatDate, formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { deleteClientAction } from "@/lib/delete-actions";
import { hasPermission } from "@/lib/permissions";
import { ClientSheet } from "@/components/clients/client-sheet";
import { computeSupplyStartDate } from "@/lib/supply-dates";
import {
  markEarlyReswitchContracts,
  markLatestContractsByPod,
  resolveStornoInfo,
} from "@/lib/storno-status";

export const dynamic = "force-dynamic";

function dec(v: { toString(): string } | null | undefined): string | null {
  if (v == null) return null;
  return v.toString();
}

export default async function ClienteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ contratto?: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const { contratto: initialContractId } = await searchParams;

  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      createdBy: { select: { name: true } },
      contracts: {
        where: { deletedAt: null, isHistorical: false },
        include: {
          supplier: true,
          collaborator: { select: { id: true, name: true } },
          commission: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      },
    },
  });

  if (!client || client.deletedAt) notFound();

  const isCollaboratorOnClient = client.contracts.some(
    (c) => c.collaboratorId === session.id,
  );
  const canEditClient =
    hasPermission(session.role, "clients.edit_all") ||
    client.createdById === session.id ||
    isCollaboratorOnClient;
  const canEditAllContracts = hasPermission(session.role, "contracts.edit_all");
  const canChangeCollaborator = hasPermission(session.role, "contracts.change_collaborator");
  const canEditGettone = hasPermission(session.role, "commissions.edit_gettone");
  const canEditOwnGettone = hasPermission(session.role, "commissions.edit_own_gettone");

  const [suppliers, listinoRulesRaw, collaborators] = await Promise.all([
    prisma.supplier.findMany({
      where: { active: true },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
    prisma.commissionRule.findMany({
      where: { active: true },
      select: {
        id: true,
        supplierId: true,
        name: true,
        clientSegment: true,
        fixedAmount: true,
        gettoneBase: true,
        gettoneRid: true,
        gettoneBollettaWeb: true,
        gettoneMail: true,
        gettoneUnaTantumIniziale: true,
        gettoneMensile: true,
      },
      orderBy: [{ name: "asc" }],
    }),
    canChangeCollaborator || hasPermission(session.role, "contracts.change_collaborator_dashboard")
      ? prisma.user.findMany({
          where: {
            active: true,
            role: { in: ["COLLABORATORE", "COMMERCIALE", "AREA_MANAGER", "ADMIN", "SEGRETERIA"] },
          },
          select: { id: true, name: true, active: true, role: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const listinoRules = listinoRulesRaw.map((r) => {
    const n = (v: { toString(): string } | null | undefined) =>
      v == null ? 0 : Number(v.toString()) || 0;
    const hasParts =
      r.gettoneBase != null ||
      r.gettoneRid != null ||
      r.gettoneBollettaWeb != null ||
      r.gettoneMail != null ||
      r.gettoneUnaTantumIniziale != null;
    const base = hasParts ? n(r.gettoneBase) : n(r.fixedAmount) || n(r.gettoneBase);
    const totale =
      base +
      n(r.gettoneRid) +
      n(r.gettoneBollettaWeb) +
      n(r.gettoneMail) +
      n(r.gettoneUnaTantumIniziale);
    return {
      id: r.id,
      supplierId: r.supplierId,
      name: r.name,
      clientSegment: r.clientSegment || "TUTTI",
      gettoneBase: base > 0 ? base.toFixed(2) : "",
      gettoneTotale: totale > 0 ? totale.toFixed(2) : "",
      hasRid: n(r.gettoneRid) > 0,
    };
  });

  const latestMap = markLatestContractsByPod(
    client.contracts.map((c) => ({
      id: c.id,
      clientId: client.id,
      supplierId: c.supplierId,
      podPdr: c.podPdr || c.pod || c.pdr,
      supplyStartDate: c.supplyStartDate,
      insertionDate: c.insertionDate,
      createdAt: c.createdAt,
    })),
  );
  const earlyMap = markEarlyReswitchContracts(
    client.contracts.map((c) => ({
      id: c.id,
      clientId: client.id,
      supplierId: c.supplierId,
      podPdr: c.podPdr || c.pod || c.pdr,
      supplyStartDate: c.supplyStartDate,
      insertionDate: c.insertionDate,
      createdAt: c.createdAt,
      collectionDate: c.collectionDate,
      stornoMonths: c.supplier.stornoMonths,
      stornoEndDate: c.stornoEndDate,
    })),
  );

  const sheetContracts = client.contracts.map((c) => {
    const supply =
      c.supplyStartDate ?? computeSupplyStartDate(c.insertionDate, c.operationType);
    const storno = resolveStornoInfo({
      status: c.status,
      recurrence: c.recurrence,
      supplyStartDate: supply,
      stornoMonths: c.supplier.stornoMonths,
      stornoEndDate: c.stornoEndDate,
      expiryDate: c.expiryDate,
      durationMonths: c.durationMonths,
      isLatestForPod: latestMap.get(c.id) ?? true,
      collectionDate: c.collectionDate,
      isEarlyReswitch: earlyMap.get(c.id) ?? false,
    });

    return {
    id: c.id,
    contractNumber: c.contractNumber,
    status: c.status,
    insertionDate: formatDate(c.insertionDate),
    updatedAt: formatDateTime(c.updatedAt),
    utilityType: c.utilityType,
    operationType: c.operationType,
    operationOther: c.operationOther,
    serviceOther: c.serviceOther,
    podPdr: c.podPdr,
    pod: c.pod,
    pdr: c.pdr,
    powerKw: dec(c.powerKw),
    annualKwh: dec(c.annualKwh),
    annualSmc: dec(c.annualSmc),
    supplyClassification: c.supplyClassification,
    voltageLevel: c.voltageLevel,
    supplyStartDate: c.supplyStartDate
      ? c.supplyStartDate.toISOString().slice(0, 10)
      : null,
    notes: c.notes,
    paymentMethod: c.paymentMethod,
    contractIban: c.contractIban,
    ibanHolder: c.ibanHolder,
    ibanHolderCf: c.ibanHolderCf,
    sepaMandate: c.sepaMandate,
    paymentNotes: c.paymentNotes,
    addressesMatch: c.addressesMatch,
    supplyStreet: c.supplyStreet,
    supplyStreetNumber: c.supplyStreetNumber,
    supplyZipCode: c.supplyZipCode,
    supplyCity: c.supplyCity,
    supplyProvince: c.supplyProvince,
    supplyRegion: c.supplyRegion,
    supplyCountry: c.supplyCountry,
    supplyAddress: c.supplyAddress,
    productName: c.productName,
    offerCode: c.offerCode,
    priceType: c.priceType,
    pcv: dec(c.pcv),
    pricePerKwh: dec(c.pricePerKwh),
    pricePerSmc: dec(c.pricePerSmc),
    spread: dec(c.spread),
    monthlyFee: dec(c.monthlyFee),
    oneOffFee: dec(c.oneOffFee),
    discount: dec(c.discount),
    economicNotes: c.economicNotes,
    durationMonths: c.durationMonths,
    subscriptionDate: c.subscriptionDate
      ? c.subscriptionDate.toISOString().slice(0, 10)
      : null,
    supplierId: c.supplierId,
    supplierName: c.supplier.name,
    collaboratorId: c.collaboratorId,
    collaboratorName: c.collaborator.name,
    gettone: Number(c.commission?.expected ?? 0).toFixed(2),
    commissionConfirmed: c.commissionConfirmed,
    commissionRuleId: c.commissionRuleId,
    warnOnEdit: storno.warnOnEdit,
    stornoLabel: storno.label,
    koReason: c.koReason,
    koNotes: c.koNotes,
    parentContractId: c.parentContractId,
    emailStatus: c.emailStatus,
    createdAt: c.createdAt.toISOString(),
  };
  });

  // Stesso nome in anagrafica = possibili clienti duplicati (es. 2 «IL DECORATORE»)
  const orSameIdentity = [
    client.companyName
      ? {
          companyName: {
            equals: client.companyName,
            mode: "insensitive" as const,
          },
        }
      : null,
    client.fiscalCode
      ? {
          fiscalCode: {
            equals: client.fiscalCode,
            mode: "insensitive" as const,
          },
        }
      : null,
    client.vatNumber
      ? {
          vatNumber: {
            equals: client.vatNumber,
            mode: "insensitive" as const,
          },
        }
      : null,
  ].filter(Boolean) as object[];

  const duplicateClients =
    orSameIdentity.length > 0
      ? await prisma.client.findMany({
          where: {
            id: { not: client.id },
            deletedAt: null,
            OR: orSameIdentity,
          },
          select: {
            id: true,
            companyName: true,
            firstName: true,
            lastName: true,
            type: true,
            _count: {
              select: { contracts: { where: { deletedAt: null } } },
            },
          },
          take: 8,
        })
      : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{clientDisplayName(client)}</h1>
          <p className="text-slate-500">
            {client.type === "AZIENDA" ? "Business" : "Privato"} · Creato da{" "}
            {client.createdBy.name} · {sheetContracts.length} contrat
            {sheetContracts.length === 1 ? "to" : "ti"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/contratti/nuovo?clientId=${client.id}`}>
            <Button>Nuovo contratto</Button>
          </Link>
          {hasPermission(session.role, "clients.edit_all") ? (
            <form action={deleteClientAction}>
              <input type="hidden" name="clientId" value={client.id} />
              <Button type="submit" variant="secondary">
                Elimina cliente
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      {duplicateClients.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-medium">
            Attenzione: esistono altre anagrafiche con lo stesso nome / CF / P.IVA.
          </p>
          <p className="mt-1 text-xs text-amber-900/80">
            In Provvigioni puoi vedere contratti di clienti diversi omonimi. Apri anche queste
            schede:
          </p>
          <ul className="mt-2 space-y-1">
            {duplicateClients.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/clienti/${d.id}`}
                  className="font-medium text-emerald-800 underline"
                >
                  {clientDisplayName(d)}
                </Link>
                <span className="text-xs text-amber-900/70">
                  {" "}
                  · {d._count.contracts} contrat
                  {d._count.contracts === 1 ? "to" : "ti"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ClientSheet
        client={{
          id: client.id,
          type: client.type,
          companyName: client.companyName,
          firstName: client.firstName,
          lastName: client.lastName,
          fiscalCode: client.fiscalCode,
          vatNumber: client.vatNumber,
          email: client.email,
          pec: client.pec,
          phone: client.phone,
          iban: client.iban,
          address: client.address,
          street: client.street,
          streetNumber: client.streetNumber,
          city: client.city,
          province: client.province,
          region: client.region,
          zipCode: client.zipCode,
          country: client.country,
          classification: client.classification,
          legalFirstName: client.legalFirstName,
          legalLastName: client.legalLastName,
          legalFiscalCode: client.legalFiscalCode,
          sdiCode: client.sdiCode,
          notes: client.notes,
        }}
        contracts={sheetContracts}
        suppliers={suppliers}
        listinoRules={listinoRules}
        collaborators={collaborators}
        canEditClient={canEditClient}
        canEditAllContracts={canEditAllContracts}
        sessionUserId={session.id}
        canChangeCollaborator={canChangeCollaborator}
        canEditGettone={canEditGettone}
        canEditOwnGettone={canEditOwnGettone}
        initialContractId={initialContractId}
      />
    </div>
  );
}
