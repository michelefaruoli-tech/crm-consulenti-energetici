"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import {
  canConfirmCommission,
  canEditGettoneAmount,
  hasPermission,
} from "@/lib/permissions";
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
    if (field === "expected") {
      if (
        !canEditGettoneAmount(
          session.role,
          session.id,
          commission.contract.collaboratorId,
        )
      ) {
        throw new Error("Non puoi modificare il valore gettone");
      }
    } else if (!canAll) {
      throw new Error("Puoi modificare solo il gettone previsto");
    }
    await prisma.commission.update({
      where: { id: commissionId },
      data: { [field]: amount },
    });
    if (field === "expected") {
      const isAdminGettone = hasPermission(session.role, "commissions.edit_gettone");
      // Admin/Segreteria → auto-verde; collaboratore → giallo da confermare
      await prisma.contract.update({
        where: { id: commission.contractId },
        data: isAdminGettone
          ? { commissionConfirmed: true, commissionConfirmedAt: new Date() }
          : { commissionConfirmed: false, commissionConfirmedAt: null },
      });
      await writeAuditLog({
        userId: session.id,
        action: "UPDATE",
        entity: "Commission",
        entityId: commission.contractId,
        details: {
          field: "expected",
          to: amount,
          confirmed: isAdminGettone,
          source: "provvigioni_table",
        },
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

/** Admin/Segreteria conferma il gettone (riga verde). */
export async function confirmCommissionAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!canConfirmCommission(session.role)) {
    throw new Error("Solo Admin o Segreteria possono confermare il gettone");
  }

  const commissionId = String(formData.get("commissionId") ?? "");
  if (!commissionId) throw new Error("Provvigione non specificata");

  const commission = await prisma.commission.findUnique({
    where: { id: commissionId },
    select: { id: true, contractId: true },
  });
  if (!commission) throw new Error("Provvigione non trovata");

  await prisma.contract.update({
    where: { id: commission.contractId },
    data: {
      commissionConfirmed: true,
      commissionConfirmedAt: new Date(),
    },
  });

  await writeAuditLog({
    userId: session.id,
    action: "UPDATE",
    entity: "Contract",
    entityId: commission.contractId,
    details: { field: "commissionConfirmed", to: true, source: "confirm_button" },
  });

  revalidatePath("/provvigioni");
  revalidatePath("/");
  revalidatePath(`/contratti`);
  revalidatePath(`/clienti`);
}
