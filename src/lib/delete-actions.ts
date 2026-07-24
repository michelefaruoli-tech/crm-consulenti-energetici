"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { canDeleteClient, canDeleteContract } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/** Soft-delete contratto. */
export async function deleteContractAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const contractId = String(formData.get("contractId") ?? "");
  if (!contractId) throw new Error("Contratto mancante");

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { id: true, clientId: true, collaboratorId: true, status: true, deletedAt: true },
  });
  if (!contract || contract.deletedAt) throw new Error("Contratto non trovato");
  if (!canDeleteContract(session.role, session.id, contract.collaboratorId)) {
    throw new Error("Non hai il permesso di eliminare questo contratto");
  }

  await softDeleteContract(contract.id, session.id, contract.status);
  revalidatePath("/contratti");
  revalidatePath("/lavorazione");
  revalidatePath("/attesa-pagamento");
  revalidatePath("/provvigioni");
  revalidatePath("/archivio");
  revalidatePath("/");
  revalidatePath(`/clienti/${contract.clientId}`);
  redirect("/contratti");
}

export async function deleteContractRowAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireSession();
    const contractId = String(formData.get("contractId") ?? "");
    if (!contractId) return { ok: false, error: "Contratto mancante" };

    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      select: {
        id: true,
        clientId: true,
        collaboratorId: true,
        status: true,
        deletedAt: true,
      },
    });
    if (!contract || contract.deletedAt) {
      return { ok: false, error: "Contratto non trovato" };
    }
    if (!canDeleteContract(session.role, session.id, contract.collaboratorId)) {
      return { ok: false, error: "Puoi eliminare solo i tuoi contratti" };
    }

    await softDeleteContract(contract.id, session.id, contract.status);

    revalidatePath("/contratti");
    revalidatePath("/lavorazione");
    revalidatePath("/attesa-pagamento");
    revalidatePath("/provvigioni");
    revalidatePath("/archivio");
    revalidatePath("/");
    revalidatePath(`/clienti/${contract.clientId}`);
    return { ok: true };
  } catch (e) {
    console.error("[deleteContractRowAction]", e);
    return { ok: false, error: friendlyDbError(e) };
  }
}

export async function deleteClientAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const clientId = String(formData.get("clientId") ?? "");
  if (!clientId) throw new Error("Cliente mancante");

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, createdById: true, deletedAt: true },
  });
  if (!client || client.deletedAt) throw new Error("Cliente non trovato");
  if (!canDeleteClient(session.role, session.id, client.createdById)) {
    throw new Error("Non hai il permesso di eliminare questo cliente");
  }

  await softDeleteClient(clientId, session.id);
  revalidatePath("/clienti");
  revalidatePath("/contratti");
  revalidatePath("/provvigioni");
  revalidatePath("/archivio");
  revalidatePath("/");
  redirect("/clienti");
}

export async function deleteClientRowAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireSession();
    const clientId = String(formData.get("clientId") ?? "");
    if (!clientId) return { ok: false, error: "Cliente mancante" };

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, createdById: true, deletedAt: true },
    });
    if (!client || client.deletedAt) {
      return { ok: false, error: "Cliente non trovato" };
    }
    if (!canDeleteClient(session.role, session.id, client.createdById)) {
      return { ok: false, error: "Puoi eliminare solo i clienti che hai creato" };
    }

    await softDeleteClient(clientId, session.id);

    revalidatePath("/clienti");
    revalidatePath("/contratti");
    revalidatePath("/provvigioni");
    revalidatePath("/archivio");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    console.error("[deleteClientRowAction]", e);
    return { ok: false, error: friendlyDbError(e) };
  }
}

async function softDeleteContract(
  contractId: string,
  userId: string,
  previousStatus: string,
): Promise<void> {
  const now = new Date();
  await prisma.contract.update({
    where: { id: contractId },
    data: { deletedAt: now, status: "ANNULLATO" },
  });
  await writeAuditLog({
    userId,
    action: "SOFT_DELETE",
    entity: "Contract",
    entityId: contractId,
    details: { previousStatus, deletedAt: now.toISOString() },
  });
}

/** Soft-delete senza $transaction (Neon HTTP non le supporta). */
async function softDeleteClient(clientId: string, userId: string): Promise<void> {
  const now = new Date();
  const contracts = await prisma.contract.findMany({
    where: { clientId, deletedAt: null },
    select: { id: true, status: true },
  });

  for (const c of contracts) {
    await prisma.contract.update({
      where: { id: c.id },
      data: { deletedAt: now, status: "ANNULLATO" },
    });
    await writeAuditLog({
      userId,
      action: "SOFT_DELETE",
      entity: "Contract",
      entityId: c.id,
      details: { reason: "client_delete", previousStatus: c.status },
    });
  }

  await prisma.client.update({
    where: { id: clientId },
    data: { deletedAt: now },
  });
  await writeAuditLog({
    userId,
    action: "SOFT_DELETE",
    entity: "Client",
    entityId: clientId,
    details: { contractsArchived: contracts.length },
  });
}

function friendlyDbError(e: unknown): string {
  const msg = e instanceof Error ? e.message : "Eliminazione non riuscita";
  if (msg.includes("HTTP mode") || msg.includes("Transactions")) {
    return "Eliminazione non riuscita (database). Riprova.";
  }
  if (msg.includes("permesso") || msg.includes("Puoi eliminare")) return msg;
  return msg.slice(0, 180);
}
