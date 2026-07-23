"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { parseFlexibleDate } from "@/lib/date-parse";
import { syncRecurringMonthsForContract } from "@/lib/recurring-sync";

export async function updateCommissionFieldAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const commissionId = String(formData.get("commissionId") ?? "");
  const field = String(formData.get("field") ?? "");
  const value = String(formData.get("value") ?? "");

  const commission = await prisma.commission.findUnique({
    where: { id: commissionId },
    include: { contract: true },
  });
  if (!commission) throw new Error("Provvigione non trovata");

  const canAll = hasPermission(session.role, "commissions.view_all");
  if (!canAll && commission.contract.collaboratorId !== session.id) {
    throw new Error("Permesso negato");
  }

  if (field === "expected" || field === "received" || field === "paid" || field === "accrued") {
    const amount = Number(value.replace(",", ".")) || 0;
    if (!canAll && field !== "expected") {
      throw new Error("Puoi modificare solo il gettone previsto");
    }
    await prisma.commission.update({
      where: { id: commissionId },
      data: { [field]: amount },
    });
    if (field === "expected" && !canAll) {
      await prisma.contract.update({
        where: { id: commission.contractId },
        data: { commissionConfirmed: false, commissionConfirmedAt: null },
      });
    }
  } else if (field === "paymentStatus") {
    const raw = value.trim();
    const paid = /^(incass|s[iì]|si|yes|1)$/i.test(raw);
    const normalized = paid ? "Incassato" : "Da incassare";
    await prisma.contract.update({
      where: { id: commission.contractId },
      data: {
        paymentStatus: normalized,
        collectionDate: paid
          ? commission.contract.collectionDate ?? new Date()
          : null,
      },
    });
    if (paid) {
      await syncRecurringMonthsForContract(commission.contractId).catch(() => undefined);
    }
  } else if (field === "collectionDate") {
    const raw = value.trim();
    if (!raw) {
      await prisma.contract.update({
        where: { id: commission.contractId },
        data: { collectionDate: null, paymentStatus: "Da incassare" },
      });
    } else {
      const d = parseFlexibleDate(raw);
      if (!d) throw new Error("Data non valida (usa MM/AAAA o GG/MM/AAAA)");
      await prisma.contract.update({
        where: { id: commission.contractId },
        data: {
          collectionDate: d,
          paymentStatus: "Incassato",
        },
      });
      await syncRecurringMonthsForContract(commission.contractId).catch(() => undefined);
    }
  } else if (field === "recurrence") {
    const raw = value.trim();
    const normalized = /ric/i.test(raw)
      ? "Ricorrente"
      : /ut|tantum|una/i.test(raw)
        ? "Una tantum"
        : raw || "Una tantum";
    await prisma.contract.update({
      where: { id: commission.contractId },
      data: { recurrence: normalized },
    });
    await syncRecurringMonthsForContract(commission.contractId).catch(() => undefined);
  } else if (field === "podPdr") {
    await prisma.contract.update({
      where: { id: commission.contractId },
      data: { podPdr: value.trim() || null },
    });
  }

  revalidatePath("/provvigioni");
  revalidatePath("/");
  revalidatePath("/contratti");
}
