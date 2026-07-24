"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { parseFlexibleDate } from "@/lib/date-parse";
import {
  computeSupplyStartDate,
  normalizeOperationType,
} from "@/lib/supply-dates";
import { CONTRACT_STATUS_LABELS, type AppContractStatus } from "@/lib/constants";

function statusFromLabel(value: string): AppContractStatus | null {
  const raw = value.trim();
  if (!raw) return null;
  const upper = raw.toUpperCase().replace(/\s+/g, "_");
  const keys = Object.keys(CONTRACT_STATUS_LABELS) as AppContractStatus[];
  if (keys.includes(upper as AppContractStatus)) return upper as AppContractStatus;
  const found = keys.find(
    (k) => CONTRACT_STATUS_LABELS[k].toLowerCase() === raw.toLowerCase(),
  );
  return found ?? null;
}

export async function updateContractFieldAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const contractId = String(formData.get("contractId") ?? "");
  const field = String(formData.get("field") ?? "");
  const value = String(formData.get("value") ?? "");

  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract) throw new Error("Contratto non trovato");

  const canAll = hasPermission(session.role, "contracts.edit_all");
  if (!canAll && contract.collaboratorId !== session.id) {
    throw new Error("Permesso negato");
  }

  if (field === "podPdr") {
    await prisma.contract.update({
      where: { id: contractId },
      data: { podPdr: value.trim() || null },
    });
  } else if (field === "operationType") {
    const op = normalizeOperationType(value);
    const supplyStartDate = computeSupplyStartDate(contract.insertionDate, op);
    await prisma.contract.update({
      where: { id: contractId },
      data: { operationType: op, supplyStartDate },
    });
  } else if (field === "supplyStartDate") {
    const d = parseFlexibleDate(value);
    if (!d) throw new Error("Data non valida (usa GG/MM/AAAA)");
    await prisma.contract.update({
      where: { id: contractId },
      data: { supplyStartDate: d },
    });
  } else if (field === "insertionDate") {
    const d = parseFlexibleDate(value);
    if (!d) throw new Error("Data non valida (usa GG/MM/AAAA)");
    const op = normalizeOperationType(contract.operationType);
    await prisma.contract.update({
      where: { id: contractId },
      data: {
        insertionDate: d,
        supplyStartDate: computeSupplyStartDate(d, op),
      },
    });
  } else if (field === "status") {
    if (!hasPermission(session.role, "contracts.change_status")) {
      throw new Error("Non puoi cambiare lo stato");
    }
    const status = statusFromLabel(value);
    if (!status) throw new Error("Stato non riconosciuto");
    await prisma.contract.update({
      where: { id: contractId },
      data: { status },
    });
    await prisma.contractStatusHistory.create({
      data: {
        contractId,
        fromStatus: contract.status,
        toStatus: status,
        changedById: session.id,
        note: "Modifica da elenco",
      },
    });
  } else if (field === "notes") {
    await prisma.contract.update({
      where: { id: contractId },
      data: { notes: value.trim() || null },
    });
  } else if (field === "collaboratorId") {
    if (!hasPermission(session.role, "contracts.change_collaborator_dashboard")) {
      throw new Error("Non puoi cambiare il collaboratore");
    }
    const collaboratorId = value.trim();
    if (!collaboratorId) throw new Error("Collaboratore mancante");
    const collaborator = await prisma.user.findFirst({
      where: {
        id: collaboratorId,
        role: { in: ["COLLABORATORE", "COMMERCIALE", "ADMIN", "SEGRETERIA"] },
      },
      select: { id: true, name: true, active: true },
    });
    if (!collaborator) throw new Error("Collaboratore non valido");
    if (!collaborator.active && collaborator.id !== contract.collaboratorId) {
      throw new Error("Collaboratore non attivo");
    }
    if (collaborator.id === contract.collaboratorId) return;

    const previous = await prisma.user.findUnique({
      where: { id: contract.collaboratorId },
      select: { name: true },
    });

    await prisma.contract.update({
      where: { id: contractId },
      data: { collaboratorId: collaborator.id },
    });
    await prisma.auditLog.create({
      data: {
        userId: session.id,
        action: "UPDATE",
        entity: "Contract",
        entityId: contractId,
        details: JSON.stringify({
          field: "collaboratorId",
          from: contract.collaboratorId,
          fromName: previous?.name ?? null,
          to: collaborator.id,
          toName: collaborator.name,
          source: "dashboard_list",
        }),
      },
    });
  } else {
    throw new Error("Campo non modificabile");
  }

  revalidatePath("/contratti");
  revalidatePath(`/contratti/${contractId}`);
  revalidatePath("/");
  revalidatePath("/archivio");
}
