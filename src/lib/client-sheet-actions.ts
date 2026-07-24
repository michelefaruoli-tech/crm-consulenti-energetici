"use server";

import { revalidatePath } from "next/cache";
import { ContractStatus } from "@/generated/prisma/client";
import { requireSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { CONTRACT_STATUS_LABELS } from "@/lib/constants";
import { computeSupplyStartDate } from "@/lib/supply-dates";

function numOrNull(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function intOrKeep(v: FormDataEntryValue | null, fallback: number): number {
  const s = String(v ?? "").trim();
  if (!s) return fallback;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
}

function dateOrNull(v: FormDataEntryValue | null): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clean(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s || null;
}

function normalizeIban(raw: string | null): string | null {
  if (!raw) return null;
  const iban = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) {
    throw new Error("IBAN non valido");
  }
  return iban;
}

/** Blocco 2: contratto, fornitura, pagamento */
export async function updateClientContractBlockAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const contractId = clean(formData.get("contractId"));
  const clientId = clean(formData.get("clientId"));
  if (!contractId || !clientId) throw new Error("Dati mancanti");

  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract || contract.deletedAt || contract.clientId !== clientId) {
    throw new Error("Contratto non trovato");
  }

  const canAll = hasPermission(session.role, "contracts.edit_all");
  if (!canAll && contract.collaboratorId !== session.id) {
    throw new Error("Permesso negato");
  }

  const utilityType = clean(formData.get("utilityType"));
  const operationTypeRaw = clean(formData.get("operationType")) ?? "SWITCH";
  const operationOther = clean(formData.get("operationOther"));
  if (operationTypeRaw.toUpperCase() === "ALTRO" && !operationOther) {
    throw new Error("Specifica l'operazione quando selezioni Altro");
  }

  const paymentMethod = clean(formData.get("paymentMethod"));
  let contractIban = clean(formData.get("contractIban"));
  if (paymentMethod === "RID") {
    if (!contractIban) throw new Error("IBAN obbligatorio con RID / addebito");
    contractIban = normalizeIban(contractIban);
  } else if (contractIban) {
    contractIban = normalizeIban(contractIban);
  }

  const addressesMatch = formData.get("addressesMatch") === "on" || formData.get("addressesMatch") === "true";

  let supplyStreet = clean(formData.get("supplyStreet"));
  let supplyStreetNumber = clean(formData.get("supplyStreetNumber"));
  let supplyZipCode = clean(formData.get("supplyZipCode"));
  let supplyCity = clean(formData.get("supplyCity"));
  let supplyProvince = clean(formData.get("supplyProvince"));
  let supplyRegion = clean(formData.get("supplyRegion"));
  let supplyCountry = clean(formData.get("supplyCountry")) ?? "Italia";
  let supplyAddress = clean(formData.get("supplyAddress"));

  if (addressesMatch) {
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (client) {
      supplyStreet = client.street ?? client.address;
      supplyStreetNumber = client.streetNumber;
      supplyZipCode = client.zipCode;
      supplyCity = client.city;
      supplyProvince = client.province;
      supplyRegion = client.region;
      supplyCountry = client.country ?? "Italia";
      supplyAddress =
        [client.street ?? client.address, client.streetNumber].filter(Boolean).join(", ") ||
        client.address;
    }
  }

  const opNormalized =
    operationTypeRaw.toUpperCase() === "SWITCH" || operationTypeRaw.toUpperCase() === "CAMBIO"
      ? "SWITCH"
      : operationTypeRaw.toUpperCase();

  // Per calcolo date inizio fornitura usiamo ancora normalizeOperationType
  const supplyStartDate = computeSupplyStartDate(
    contract.insertionDate,
    opNormalized === "SWITCH" ? "CAMBIO" : opNormalized,
  );

  const data = {
    utilityType,
    operationType: opNormalized,
    operationOther: opNormalized === "ALTRO" ? operationOther : null,
    serviceOther: clean(formData.get("serviceOther")),
    podPdr: clean(formData.get("podPdr")),
    pod: clean(formData.get("pod")),
    pdr: clean(formData.get("pdr")),
    powerKw: numOrNull(formData.get("powerKw")),
    annualKwh: numOrNull(formData.get("annualKwh")),
    annualSmc: numOrNull(formData.get("annualSmc")),
    supplyClassification: clean(formData.get("supplyClassification")),
    voltageLevel: clean(formData.get("voltageLevel")),
    supplyStartDate: dateOrNull(formData.get("supplyStartDate")) ?? supplyStartDate,
    notes: clean(formData.get("notes")),
    paymentMethod,
    contractIban,
    ibanHolder: clean(formData.get("ibanHolder")),
    ibanHolderCf: clean(formData.get("ibanHolderCf")),
    sepaMandate: clean(formData.get("sepaMandate")),
    paymentNotes: clean(formData.get("paymentNotes")),
    addressesMatch,
    supplyStreet,
    supplyStreetNumber,
    supplyZipCode,
    supplyCity,
    supplyProvince,
    supplyRegion,
    supplyCountry,
    supplyAddress,
    technicalJson: clean(formData.get("technicalJson")),
  };

  await prisma.contract.update({ where: { id: contractId }, data });

  await writeAuditLog({
    userId: session.id,
    action: "UPDATE",
    entity: "Contract",
    entityId: contractId,
    details: { source: "client_sheet_block2", fields: Object.keys(data) },
  });

  revalidatePath(`/clienti/${clientId}`);
  revalidatePath(`/contratti/${contractId}`);
  revalidatePath("/contratti");
  revalidatePath("/");
}

/** Blocco 3: fornitore, offerta, stato, gettone */
export async function updateClientOfferBlockAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const contractId = clean(formData.get("contractId"));
  const clientId = clean(formData.get("clientId"));
  if (!contractId || !clientId) throw new Error("Dati mancanti");

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: { commission: true },
  });
  if (!contract || contract.deletedAt || contract.clientId !== clientId) {
    throw new Error("Contratto non trovato");
  }

  const canAll = hasPermission(session.role, "contracts.edit_all");
  const canStatus = hasPermission(session.role, "contracts.change_status");
  if (!canAll && contract.collaboratorId !== session.id) {
    throw new Error("Permesso negato");
  }

  const statusRaw = clean(formData.get("status"));
  const koReason = clean(formData.get("koReason"));
  const koNotes = clean(formData.get("koNotes"));

  if (statusRaw) {
    if (!canStatus && !(hasPermission(session.role, "contracts.edit_own") && contract.collaboratorId === session.id)) {
      throw new Error("Non puoi cambiare lo stato");
    }
    const status = statusRaw as ContractStatus;
    if (!(status in CONTRACT_STATUS_LABELS)) {
      throw new Error("Stato non valido");
    }
    if ((status === "KO" || status === "ANNULLATO") && !koReason) {
      throw new Error(status === "KO" ? "Motivo KO obbligatorio" : "Motivo annullamento obbligatorio");
    }

    if (status !== contract.status) {
      await prisma.contract.update({
        where: { id: contractId },
        data: {
          status,
          koReason: status === "KO" || status === "ANNULLATO" ? koReason : contract.koReason,
          koNotes: status === "KO" || status === "ANNULLATO" ? koNotes : contract.koNotes,
          productName: clean(formData.get("productName")),
          offerCode: clean(formData.get("offerCode")),
          priceType: clean(formData.get("priceType")),
          pcv: numOrNull(formData.get("pcv")),
          pricePerKwh: numOrNull(formData.get("pricePerKwh")),
          pricePerSmc: numOrNull(formData.get("pricePerSmc")),
          spread: numOrNull(formData.get("spread")),
          monthlyFee: numOrNull(formData.get("monthlyFee")),
          oneOffFee: numOrNull(formData.get("oneOffFee")),
          discount: numOrNull(formData.get("discount")),
          economicNotes: clean(formData.get("economicNotes")),
          durationMonths: intOrKeep(formData.get("durationMonths"), contract.durationMonths),
          subscriptionDate: dateOrNull(formData.get("subscriptionDate")) ?? undefined,
          supplierId: clean(formData.get("supplierId")) ?? contract.supplierId,
        },
      });
      await prisma.contractStatusHistory.create({
        data: {
          contractId,
          fromStatus: contract.status,
          toStatus: status,
          changedById: session.id,
          note: clean(formData.get("statusNote")),
          changeReason: koReason,
          koReason,
        },
      });
    } else {
      await prisma.contract.update({
        where: { id: contractId },
        data: {
          productName: clean(formData.get("productName")),
          offerCode: clean(formData.get("offerCode")),
          priceType: clean(formData.get("priceType")),
          pcv: numOrNull(formData.get("pcv")),
          pricePerKwh: numOrNull(formData.get("pricePerKwh")),
          pricePerSmc: numOrNull(formData.get("pricePerSmc")),
          spread: numOrNull(formData.get("spread")),
          monthlyFee: numOrNull(formData.get("monthlyFee")),
          oneOffFee: numOrNull(formData.get("oneOffFee")),
          discount: numOrNull(formData.get("discount")),
          economicNotes: clean(formData.get("economicNotes")),
          durationMonths: intOrKeep(formData.get("durationMonths"), contract.durationMonths),
          subscriptionDate: dateOrNull(formData.get("subscriptionDate")) ?? undefined,
          supplierId: clean(formData.get("supplierId")) ?? contract.supplierId,
          koReason: status === "KO" || status === "ANNULLATO" ? koReason : undefined,
          koNotes: status === "KO" || status === "ANNULLATO" ? koNotes : undefined,
        },
      });
    }
  }

  const gettoneRaw = clean(formData.get("gettone"));
  if (gettoneRaw != null) {
    if (!hasPermission(session.role, "commissions.edit_gettone")) {
      throw new Error("Non puoi modificare il valore gettone");
    }
    const amount = Number(gettoneRaw.replace(",", ".")) || 0;
    const prev = Number(contract.commission?.expected ?? 0);
    if (contract.commission) {
      await prisma.commission.update({
        where: { id: contract.commission.id },
        data: { expected: amount },
      });
    } else {
      await prisma.commission.create({
        data: { contractId, expected: amount },
      });
    }
    if (prev !== amount) {
      await writeAuditLog({
        userId: session.id,
        action: "UPDATE",
        entity: "Commission",
        entityId: contractId,
        details: { field: "expected", from: prev, to: amount },
      });
    }
  }

  // Cambio collaboratore solo Admin dalla scheda
  const newCollaboratorId = clean(formData.get("collaboratorId"));
  if (newCollaboratorId && newCollaboratorId !== contract.collaboratorId) {
    if (!hasPermission(session.role, "contracts.change_collaborator")) {
      throw new Error("Solo l'amministratore può cambiare il collaboratore dalla scheda");
    }
    const collab = await prisma.user.findFirst({
      where: {
        id: newCollaboratorId,
        active: true,
        role: { in: ["COLLABORATORE", "COMMERCIALE", "ADMIN", "SEGRETERIA"] },
      },
    });
    if (!collab) throw new Error("Collaboratore non valido");
    await prisma.contract.update({
      where: { id: contractId },
      data: { collaboratorId: collab.id },
    });
    await writeAuditLog({
      userId: session.id,
      action: "UPDATE",
      entity: "Contract",
      entityId: contractId,
      details: {
        field: "collaboratorId",
        from: contract.collaboratorId,
        to: collab.id,
        source: "client_sheet_block3",
      },
    });
  }

  revalidatePath(`/clienti/${clientId}`);
  revalidatePath(`/contratti/${contractId}`);
  revalidatePath("/contratti");
  revalidatePath("/provvigioni");
  revalidatePath("/");
}
