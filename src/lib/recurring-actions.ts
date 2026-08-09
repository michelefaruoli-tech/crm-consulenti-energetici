"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { toPeriod } from "@/lib/recurring";
import { syncRecurringMonthsForContract } from "@/lib/recurring-sync";

const ALLOWED = new Set([
  "PAID",
  "PENDING",
  "MISSING",
  "CLOSED",
  "ERROR_UNPAID",
  "LIQUIDATED",
]);

/**
 * Aggiorna lo stato di un mese di competenza ricorrente.
 * - PAID = incassato dal fornitore (chiede settledPeriod)
 * - LIQUIDATED = pagato al collaboratore (esce dalle liste da liquidare)
 */
export async function updateRecurringMonthStatusAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get("recurringMonthId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !ALLOWED.has(status)) throw new Error("Dati non validi");

  const row = await prisma.recurringMonth.findUnique({
    where: { id },
    include: {
      contract: {
        select: {
          collaboratorId: true,
          id: true,
          commission: { select: { id: true, expected: true, received: true, paid: true } },
        },
      },
    },
  });
  if (!row) throw new Error("Mese non trovato");

  const canAll = hasPermission(session.role, "commissions.view_all");
  if (!canAll && row.contract.collaboratorId !== session.id) {
    throw new Error("Permesso negato");
  }

  let settledPeriod: string | null = row.settledPeriod;
  if (status === "PAID" || status === "LIQUIDATED") {
    const raw = String(formData.get("settledPeriod") ?? "").trim();
    if (/^\d{4}-\d{2}$/.test(raw)) settledPeriod = raw;
    else if (!settledPeriod) settledPeriod = toPeriod(new Date());
  }

  await prisma.recurringMonth.update({
    where: { id },
    data: {
      status,
      paidAt:
        status === "PAID" || status === "LIQUIDATED"
          ? row.paidAt ?? new Date()
          : status === "MISSING" || status === "PENDING"
            ? null
            : row.paidAt,
      settledPeriod:
        status === "PAID" || status === "LIQUIDATED" ? settledPeriod : null,
      note:
        status === "ERROR_UNPAID"
          ? "Segnato come non pagato per errore"
          : status === "CLOSED"
            ? "Contratto chiuso"
            : status === "LIQUIDATED"
              ? "Liquidato al collaboratore"
              : row.note,
    },
  });

  if (status === "PAID" || status === "LIQUIDATED") {
    const latestPaid = await prisma.recurringMonth.findFirst({
      where: {
        contractId: row.contractId,
        status: { in: ["PAID", "LIQUIDATED"] },
      },
      orderBy: { period: "desc" },
      select: { period: true },
    });
    const competence = latestPaid?.period ?? row.period;
    const [y, m] = competence.split("-").map(Number);
    await prisma.contract.update({
      where: { id: row.contractId },
      data: {
        paymentStatus: status === "LIQUIDATED" ? "Pagato" : "Incassato",
        collectionDate: new Date(y, m - 1, 1),
      },
    });
  }

  if (status === "LIQUIDATED") {
    const commission = row.contract.commission;
    if (commission) {
      const amount = Number(row.amount ?? commission.expected ?? 0) || 0;
      const paid = Number(commission.paid ?? 0) || 0;
      const received = Number(commission.received ?? 0) || 0;
      await prisma.commission.update({
        where: { id: commission.id },
        data: {
          paid: paid + amount,
          received: Math.max(received, paid + amount),
        },
      });
    }
  }

  await syncRecurringMonthsForContract(row.contractId);
  revalidatePath("/provvigioni");
  revalidatePath(`/contratti/${row.contractId}`);
  revalidatePath(`/clienti`);
}

/** Correzione autorizzata: Helios luglio 2026 non è ancora stato incassato. */
export async function resetHeliosJuly2026Action(): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "commissions.view_all")) throw new Error("Permesso negato");
  const rows = await prisma.recurringMonth.findMany({
    where: {
      period: "2026-07",
      status: { in: ["PAID", "LIQUIDATED"] },
      contract: { supplier: { name: { equals: "Helios", mode: "insensitive" } } },
    },
    select: { id: true, contractId: true },
  });
  for (const row of rows) {
    await prisma.recurringMonth.update({
      where: { id: row.id },
      data: { status: "MISSING", paidAt: null, settledPeriod: null, note: "Helios luglio 2026 da incassare" },
    });
  }
  for (const contractId of [...new Set(rows.map((row) => row.contractId))]) {
    const latest = await prisma.recurringMonth.findFirst({
      where: { contractId, status: { in: ["PAID", "LIQUIDATED"] }, period: { lt: "2026-07" } },
      orderBy: { period: "desc" },
      select: { period: true },
    });
    await prisma.contract.update({
      where: { id: contractId },
      data: {
        paymentStatus: latest ? "Incassato" : "Da incassare",
        collectionDate: latest
          ? new Date(Number(latest.period.slice(0, 4)), Number(latest.period.slice(5, 7)) - 1, 1)
          : null,
      },
    });
  }
  revalidatePath("/provvigioni");
}
