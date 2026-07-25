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
  } else if (field === "notes") {
    await prisma.contract.update({
      where: { id: commission.contractId },
      data: { notes: value.trim() || null },
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

function parseIdList(formData: FormData, key: string): string[] {
  const raw = String(formData.get(key) ?? "");
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

async function assertCanAccessCommissions(
  session: { id: string; role: Parameters<typeof hasPermission>[0] },
  commissionIds: string[],
) {
  if (commissionIds.length === 0) throw new Error("Nessuna riga selezionata");
  if (commissionIds.length > 200) throw new Error("Massimo 200 righe per volta");

  const rows = await prisma.commission.findMany({
    where: { id: { in: commissionIds } },
    select: {
      id: true,
      contractId: true,
      contract: { select: { collaboratorId: true, recurrence: true } },
    },
  });
  if (rows.length === 0) throw new Error("Nessuna provvigione trovata");

  const canAll = hasPermission(session.role, "commissions.view_all");
  for (const r of rows) {
    if (!canAll && r.contract.collaboratorId !== session.id) {
      throw new Error("Permesso negato su una o più righe");
    }
  }
  return rows;
}

/** Segna pagato (collectionDate) su più contratti. */
export async function bulkMarkPaidAction(formData: FormData): Promise<{ ok: true; count: number }> {
  const session = await requireSession();
  const ids = parseIdList(formData, "commissionIds");
  const rows = await assertCanAccessCommissions(session, ids);

  const monthRaw = String(formData.get("collectionMonth") ?? "").trim();
  let collectionDate = new Date();
  if (monthRaw) {
    const d = parseFlexibleDate(monthRaw);
    if (!d) throw new Error("Data non valida (usa MM/AAAA)");
    collectionDate = d;
  }

  for (const r of rows) {
    await prisma.contract.update({
      where: { id: r.contractId },
      data: {
        paymentStatus: "Incassato",
        collectionDate,
      },
    });
  }

  await writeAuditLog({
    userId: session.id,
    action: "UPDATE",
    entity: "Commission",
    entityId: rows[0]?.contractId ?? "",
    details: {
      source: "bulk_mark_paid",
      count: rows.length,
      collectionDate: collectionDate.toISOString().slice(0, 10),
    },
  });

  revalidatePath("/provvigioni");
  revalidatePath("/");
  revalidatePath("/contratti");
  return { ok: true, count: rows.length };
}

/** Conferma gettone (verde) su più contratti — solo Admin/Segreteria. */
export async function bulkConfirmCommissionsAction(
  formData: FormData,
): Promise<{ ok: true; count: number }> {
  const session = await requireSession();
  if (!canConfirmCommission(session.role)) {
    throw new Error("Solo Admin o Segreteria possono confermare il gettone");
  }
  const ids = parseIdList(formData, "commissionIds");
  const rows = await assertCanAccessCommissions(session, ids);
  const now = new Date();

  for (const r of rows) {
    await prisma.contract.update({
      where: { id: r.contractId },
      data: {
        commissionConfirmed: true,
        commissionConfirmedAt: now,
      },
    });
  }

  await writeAuditLog({
    userId: session.id,
    action: "UPDATE",
    entity: "Commission",
    entityId: rows[0]?.contractId ?? "",
    details: { source: "bulk_confirm", count: rows.length },
  });

  revalidatePath("/provvigioni");
  revalidatePath("/");
  revalidatePath("/contratti");
  return { ok: true, count: rows.length };
}

/**
 * Per ogni contratto selezionato ricorrente:
 * - mode=oldest → paga il mese MISSING più vecchio
 * - mode=all → paga tutti i mesi MISSING
 * con settledPeriod = mese del bonifico/rendiconto.
 */
export async function bulkPayRecurringAction(
  formData: FormData,
): Promise<{ ok: true; monthsPaid: number; contracts: number }> {
  const session = await requireSession();
  const ids = parseIdList(formData, "commissionIds");
  const rows = await assertCanAccessCommissions(session, ids);
  const mode = String(formData.get("mode") ?? "oldest");
  const settledRaw = String(formData.get("settledPeriod") ?? "").trim();
  const settledPeriod = /^\d{4}-\d{2}$/.test(settledRaw)
    ? settledRaw
    : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

  let monthsPaid = 0;
  let contractsTouched = 0;

  for (const r of rows) {
    const missing = await prisma.recurringMonth.findMany({
      where: { contractId: r.contractId, status: "MISSING" },
      orderBy: { period: "asc" },
    });
    if (missing.length === 0) continue;

    const toPay = mode === "all" ? missing : [missing[0]];
    contractsTouched += 1;

    for (const m of toPay) {
      await prisma.recurringMonth.update({
        where: { id: m.id },
        data: {
          status: "PAID",
          paidAt: new Date(),
          settledPeriod,
        },
      });
      monthsPaid += 1;
    }

    const latestPaid = await prisma.recurringMonth.findFirst({
      where: { contractId: r.contractId, status: "PAID" },
      orderBy: { period: "desc" },
      select: { period: true },
    });
    if (latestPaid) {
      const [y, mo] = latestPaid.period.split("-").map(Number);
      await prisma.contract.update({
        where: { id: r.contractId },
        data: {
          paymentStatus: "Incassato",
          collectionDate: new Date(y, mo - 1, 1),
        },
      });
    }
    await syncRecurringMonthsForContract(r.contractId).catch(() => undefined);
  }

  await writeAuditLog({
    userId: session.id,
    action: "UPDATE",
    entity: "RecurringMonth",
    entityId: settledPeriod,
    details: {
      source: "bulk_pay_recurring",
      mode,
      settledPeriod,
      monthsPaid,
      contracts: contractsTouched,
    },
  });

  revalidatePath("/provvigioni");
  revalidatePath("/");
  return { ok: true, monthsPaid, contracts: contractsTouched };
}
