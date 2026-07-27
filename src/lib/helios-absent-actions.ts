"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { syncRecurringMonthsForContract } from "@/lib/recurring-sync";

export type HeliosAbsentResolution =
  | "CLOSED"
  | "HELIOS_ERROR"
  | "WILL_RETURN";

const RESOLUTION_LABEL: Record<HeliosAbsentResolution, string> = {
  CLOSED: "Contratto chiuso / cessato",
  HELIOS_ERROR: "Errore Helios (manca nel rendiconto)",
  WILL_RETURN: "In attesa di rientro",
};

/**
 * Risolve alert «assente dai rendiconti»: chiude i mesi ERROR_UNPAID
 * (status CLOSED) così spariscono dalla lista. Opzionale: chiude il contratto.
 */
export async function resolveHeliosAbsentAction(formData: FormData): Promise<{
  ok?: boolean;
  error?: string;
}> {
  try {
    const session = await requireSession();
    const canAll = hasPermission(session.role, "commissions.view_all");
    const canOwn = hasPermission(session.role, "commissions.view_own");
    if (!canAll && !canOwn) return { error: "Permesso negato" };

    const contractId = String(formData.get("contractId") ?? "").trim();
    const resolution = String(
      formData.get("resolution") ?? "",
    ).trim() as HeliosAbsentResolution;
    const notes = String(formData.get("notes") ?? "").trim();

    if (!contractId) return { error: "Contratto mancante" };
    if (!RESOLUTION_LABEL[resolution]) {
      return { error: "Seleziona uno stato (es. Contratto chiuso)" };
    }

    const contract = await prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: {
        id: true,
        collaboratorId: true,
        status: true,
      },
    });
    if (!contract) return { error: "Contratto non trovato" };
    if (!canAll && contract.collaboratorId !== session.id) {
      return { error: "Permesso negato" };
    }

    const label = RESOLUTION_LABEL[resolution];
    const note = notes
      ? `Risolto alert Helios: ${label} — ${notes}`
      : `Risolto alert Helios: ${label}`;

    const months = await prisma.recurringMonth.findMany({
      where: {
        contractId,
        status: "ERROR_UNPAID",
        note: { contains: "ASSENTE_RENDICONTO" },
      },
      select: { id: true },
    });

    for (const m of months) {
      await prisma.recurringMonth.update({
        where: { id: m.id },
        data: { status: "CLOSED", note },
      });
    }

    if (resolution === "CLOSED") {
      await prisma.contract.update({
        where: { id: contractId },
        data: {
          status: "CHIUSO",
          koNotes: notes || "Chiuso da alert Helios assenti",
        },
      });
      await syncRecurringMonthsForContract(contractId).catch(() => undefined);
    }

    revalidatePath("/provvigioni");
    revalidatePath(`/contratti/${contractId}`);
    return { ok: true };
  } catch (e) {
    console.error("[resolveHeliosAbsentAction]", e);
    return {
      error:
        e instanceof Error ? e.message.slice(0, 180) : "Operazione non riuscita",
    };
  }
}
