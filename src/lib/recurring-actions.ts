"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { syncRecurringMonthsForContract } from "@/lib/recurring-sync";

const ALLOWED = new Set(["PAID", "PENDING", "MISSING", "CLOSED", "ERROR_UNPAID"]);

export async function updateRecurringMonthStatusAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get("recurringMonthId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !ALLOWED.has(status)) throw new Error("Dati non validi");

  const row = await prisma.recurringMonth.findUnique({
    where: { id },
    include: { contract: { select: { collaboratorId: true } } },
  });
  if (!row) throw new Error("Mese non trovato");

  const canAll = hasPermission(session.role, "commissions.view_all");
  if (!canAll && row.contract.collaboratorId !== session.id) {
    throw new Error("Permesso negato");
  }

  await prisma.recurringMonth.update({
    where: { id },
    data: {
      status,
      paidAt: status === "PAID" ? new Date() : status === "MISSING" || status === "PENDING" ? null : row.paidAt,
      note:
        status === "ERROR_UNPAID"
          ? "Segnato come non pagato per errore"
          : status === "CLOSED"
            ? "Contratto chiuso"
            : row.note,
    },
  });

  // Se pagato, aggiorna anche collectionDate del contratto al mese
  if (status === "PAID") {
    const [y, m] = row.period.split("-").map(Number);
    await prisma.contract.update({
      where: { id: row.contractId },
      data: {
        paymentStatus: "Incassato",
        collectionDate: new Date(y, m - 1, 1),
      },
    });
  }

  await syncRecurringMonthsForContract(row.contractId);
  revalidatePath("/provvigioni");
  revalidatePath(`/contratti/${row.contractId}`);
}
