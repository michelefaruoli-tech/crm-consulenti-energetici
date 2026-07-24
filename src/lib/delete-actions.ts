"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/** Soft-delete contratto. */
export async function deleteContractAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "contracts.edit_all")) {
    throw new Error("Solo admin/segreteria può eliminare contratti");
  }

  const contractId = String(formData.get("contractId") ?? "");
  if (!contractId) throw new Error("Contratto mancante");

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { id: true, clientId: true },
  });
  if (!contract) throw new Error("Contratto non trovato");

  await prisma.contract.update({
    where: { id: contractId },
    data: { deletedAt: new Date(), status: "ANNULLATO" },
  });

  revalidatePath("/contratti");
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
    if (!hasPermission(session.role, "contracts.edit_all")) {
      return { ok: false, error: "Solo admin/segreteria può eliminare contratti" };
    }

    const contractId = String(formData.get("contractId") ?? "");
    if (!contractId) return { ok: false, error: "Contratto mancante" };

    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      select: { clientId: true },
    });
    if (!contract) return { ok: false, error: "Contratto non trovato" };

    await prisma.contract.update({
      where: { id: contractId },
      data: { deletedAt: new Date(), status: "ANNULLATO" },
    });

    revalidatePath("/contratti");
    revalidatePath("/lavorazione");
    revalidatePath("/provvigioni");
    revalidatePath("/archivio");
    revalidatePath("/");
    revalidatePath(`/clienti/${contract.clientId}`);
    return { ok: true };
  } catch (e) {
    console.error("[deleteContractRowAction]", e);
    return {
      ok: false,
      error: friendlyDbError(e),
    };
  }
}

export async function deleteClientAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "clients.edit_all")) {
    throw new Error("Solo admin/segreteria può eliminare clienti");
  }

  const clientId = String(formData.get("clientId") ?? "");
  if (!clientId) throw new Error("Cliente mancante");

  await softDeleteClient(clientId);

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
    if (!hasPermission(session.role, "clients.edit_all")) {
      return { ok: false, error: "Solo admin/segreteria può eliminare clienti" };
    }

    const clientId = String(formData.get("clientId") ?? "");
    if (!clientId) return { ok: false, error: "Cliente mancante" };

    await softDeleteClient(clientId);

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

/** Soft-delete senza $transaction (Neon HTTP non le supporta). */
async function softDeleteClient(clientId: string): Promise<void> {
  const now = new Date();
  const contracts = await prisma.contract.findMany({
    where: { clientId, deletedAt: null },
    select: { id: true },
  });

  for (const c of contracts) {
    await prisma.contract.update({
      where: { id: c.id },
      data: { deletedAt: now, status: "ANNULLATO" },
    });
  }

  await prisma.client.update({
    where: { id: clientId },
    data: { deletedAt: now },
  });
}

function friendlyDbError(e: unknown): string {
  const msg = e instanceof Error ? e.message : "Eliminazione non riuscita";
  if (msg.includes("HTTP mode") || msg.includes("Transactions")) {
    return "Eliminazione non riuscita (database). Riprova.";
  }
  return msg.slice(0, 180);
}
