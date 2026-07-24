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

/** Elimina da elenco senza redirect forzato alla lista (per tabelle). */
export async function deleteContractRowAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
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
    return { ok: false, error: e instanceof Error ? e.message : "Eliminazione non riuscita" };
  }
}

/** Elimina cliente e tutti i suoi contratti. */
export async function deleteClientAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "clients.edit_all")) {
    throw new Error("Solo admin/segreteria può eliminare clienti");
  }

  const clientId = String(formData.get("clientId") ?? "");
  if (!clientId) throw new Error("Cliente mancante");

  await prisma.contract.updateMany({
    where: { clientId },
    data: { deletedAt: new Date(), status: "ANNULLATO" },
  });
  await prisma.client.update({
    where: { id: clientId },
    data: { deletedAt: new Date() },
  });

  revalidatePath("/clienti");
  revalidatePath("/contratti");
  revalidatePath("/provvigioni");
  revalidatePath("/archivio");
  revalidatePath("/");
  redirect("/clienti");
}

export async function deleteClientRowAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireSession();
    if (!hasPermission(session.role, "clients.edit_all")) {
      return { ok: false, error: "Solo admin/segreteria può eliminare clienti" };
    }

    const clientId = String(formData.get("clientId") ?? "");
    if (!clientId) return { ok: false, error: "Cliente mancante" };

    const activeContracts = await prisma.contract.count({
      where: { clientId, deletedAt: null, status: { notIn: ["ANNULLATO", "KO"] } },
    });

    await prisma.contract.updateMany({
      where: { clientId, deletedAt: null },
      data: { deletedAt: new Date(), status: "ANNULLATO" },
    });
    await prisma.client.update({
      where: { id: clientId },
      data: { deletedAt: new Date() },
    });

    revalidatePath("/clienti");
    revalidatePath("/contratti");
    revalidatePath("/provvigioni");
    revalidatePath("/archivio");
    revalidatePath("/");
    return {
      ok: true,
      error:
        activeContracts > 0
          ? undefined
          : undefined,
    };
  } catch (e) {
    console.error("[deleteClientRowAction]", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Eliminazione non riuscita",
    };
  }
}
