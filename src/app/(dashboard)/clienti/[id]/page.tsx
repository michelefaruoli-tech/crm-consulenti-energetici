import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { clientDisplayName, formatDate, formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { deleteClientAction } from "@/lib/delete-actions";
import { hasPermission } from "@/lib/permissions";
import { ClientSheet } from "@/components/clients/client-sheet";

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
        where: { deletedAt: null },
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

  const canEditClient =
    hasPermission(session.role, "clients.edit_all") || client.createdById === session.id;
  const canEditAllContracts = hasPermission(session.role, "contracts.edit_all");
  const canChangeCollaborator = hasPermission(session.role, "contracts.change_collaborator");
  const canEditGettone = hasPermission(session.role, "commissions.edit_gettone");

  const [suppliers, collaborators] = await Promise.all([
    prisma.supplier.findMany({
      where: { active: true },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
    canChangeCollaborator || hasPermission(session.role, "contracts.change_collaborator_dashboard")
      ? prisma.user.findMany({
          where: {
            role: { in: ["COLLABORATORE", "COMMERCIALE", "ADMIN", "SEGRETERIA"] },
          },
          select: { id: true, name: true, active: true, role: true },
          orderBy: [{ active: "desc" }, { name: "asc" }],
        })
      : Promise.resolve([]),
  ]);

  const sheetContracts = client.contracts.map((c) => ({
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
    koReason: c.koReason,
    koNotes: c.koNotes,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{clientDisplayName(client)}</h1>
          <p className="text-slate-500">
            {client.type === "AZIENDA" ? "Business" : "Privato"} · Creato da{" "}
            {client.createdBy.name}
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
        collaborators={collaborators}
        canEditClient={canEditClient}
        canEditAllContracts={canEditAllContracts}
        sessionUserId={session.id}
        canChangeCollaborator={canChangeCollaborator}
        canEditGettone={canEditGettone}
        initialContractId={initialContractId}
      />
    </div>
  );
}
