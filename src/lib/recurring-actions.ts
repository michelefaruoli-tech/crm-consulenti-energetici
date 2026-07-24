"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { toPeriod } from "@/lib/recurring";
import { syncRecurringMonthsForContract } from "@/lib/recurring-sync";

const ALLOWED = new Set(["PAID", "PENDING", "MISSING", "CLOSED", "ERROR_UNPAID"]);

/**
 * Aggiorna lo stato di un mese di competenza ricorrente.
 * Se PAID: chiede `settledPeriod` (mese del bonifico/rendiconto).
 * Es. competenza aprile + settledPeriod luglio = pagato a luglio per aprile.
 */
export async function updateRecurringMonthStatusAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get("recurringMonthId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !ALLOWED.has(status)) throw new Error("Dati non validi");

  const row = await prisma.recurringMonth.findUnique({
    where: { id },
    include: { contract: { select: { collaboratorId: true, id: true } } },
  });
  if (!row) throw new Error("Mese non trovato");

  const canAll = hasPermission(session.role, "commissions.view_all");
  if (!canAll && row.contract.collaboratorId !== session.id) {
    throw new Error("Permesso negato");
  }

  let settledPeriod: string | null = null;
  if (status === "PAID") {
    const raw = String(formData.get("settledPeriod") ?? "").trim();
    settledPeriod = /^\d{4}-\d{2}$/.test(raw) ? raw : toPeriod(new Date());
  }

  await prisma.recurringMonth.update({
    where: { id },
    data: {
      status,
      paidAt:
        status === "PAID"
          ? new Date()
          : status === "MISSING" || status === "PENDING"
            ? null
            : row.paidAt,
      settledPeriod: status === "PAID" ? settledPeriod : null,
      note:
        status === "ERROR_UNPAID"
          ? "Segnato come non pagato per errore"
          : status === "CLOSED"
            ? "Contratto chiuso"
            : row.note,
    },
  });

  // Riepilogo UX: ultimo mese di COMPETENZA pagato (non il mese del bonifico)
  if (status === "PAID") {
    const latestPaid = await prisma.recurringMonth.findFirst({
      where: { contractId: row.contractId, status: "PAID" },
      orderBy: { period: "desc" },
      select: { period: true },
    });
    const competence = latestPaid?.period ?? row.period;
    const [y, m] = competence.split("-").map(Number);
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
  revalidatePath(`/clienti`);
}
