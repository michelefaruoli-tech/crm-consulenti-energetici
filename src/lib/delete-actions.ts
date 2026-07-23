"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/** Elimina contratto (+ commissioni collegate via cascade). */
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

  await prisma.contract.delete({ where: { id: contractId } });

  revalidatePath("/contratti");
  revalidatePath("/provvigioni");
  revalidatePath("/archivio");
  revalidatePath("/");
  revalidatePath(`/clienti/${contract.clientId}`);
  redirect("/contratti");
}

/** Elimina da elenco senza redirect forzato alla lista (per tabelle). */
export async function deleteContractRowAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "contracts.edit_all")) {
    throw new Error("Solo admin/segreteria può eliminare contratti");
  }

  const contractId = String(formData.get("contractId") ?? "");
  if (!contractId) throw new Error("Contratto mancante");

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { clientId: true },
  });
  if (!contract) throw new Error("Contratto non trovato");

  await prisma.contract.delete({ where: { id: contractId } });

  revalidatePath("/contratti");
  revalidatePath("/provvigioni");
  revalidatePath("/archivio");
  revalidatePath("/");
  revalidatePath(`/clienti/${contract.clientId}`);
}

/** Elimina cliente e tutti i suoi contratti. */
export async function deleteClientAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "clients.edit_all")) {
    throw new Error("Solo admin/segreteria può eliminare clienti");
  }

  const clientId = String(formData.get("clientId") ?? "");
  if (!clientId) throw new Error("Cliente mancante");

  await prisma.contract.deleteMany({ where: { clientId } });
  await prisma.document.deleteMany({ where: { clientId } }).catch(() => undefined);
  await prisma.clientHistory.deleteMany({ where: { clientId } }).catch(() => undefined);
  await prisma.client.delete({ where: { id: clientId } });

  revalidatePath("/clienti");
  revalidatePath("/contratti");
  revalidatePath("/provvigioni");
  revalidatePath("/archivio");
  revalidatePath("/");
  redirect("/clienti");
}

export async function deleteClientRowAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "clients.edit_all")) {
    throw new Error("Solo admin/segreteria può eliminare clienti");
  }

  const clientId = String(formData.get("clientId") ?? "");
  if (!clientId) throw new Error("Cliente mancante");

  await prisma.contract.deleteMany({ where: { clientId } });
  await prisma.document.deleteMany({ where: { clientId } }).catch(() => undefined);
  await prisma.clientHistory.deleteMany({ where: { clientId } }).catch(() => undefined);
  await prisma.client.delete({ where: { id: clientId } });

  revalidatePath("/clienti");
  revalidatePath("/contratti");
  revalidatePath("/provvigioni");
  revalidatePath("/archivio");
  revalidatePath("/");
}
