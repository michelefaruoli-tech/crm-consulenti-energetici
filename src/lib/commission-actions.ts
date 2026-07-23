"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

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
    const paid = /^incass/i.test(raw);
    const normalized = paid ? "Incassato" : "Da incassare";
    await prisma.contract.update({
      where: { id: commission.contractId },
      data: {
        paymentStatus: normalized,
        collectionDate: paid
          ? (commission.contract.collectionDate ?? new Date())
          : null,
      },
    });
  } else if (field === "recurrence") {
    await prisma.contract.update({
      where: { id: commission.contractId },
      data: { recurrence: value.trim() || null },
    });
  } else if (field === "podPdr") {
    await prisma.contract.update({
      where: { id: commission.contractId },
      data: { podPdr: value.trim() || null },
    });
  }

  revalidatePath("/provvigioni");
  revalidatePath("/");
}
