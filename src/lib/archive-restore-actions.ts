"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { defaultCommissionExpected } from "@/lib/commission";
import { reactivateContractFields } from "@/lib/contract-reactivate";
import { syncRecurringMonthsForContract } from "@/lib/recurring-sync";

export type RestoreTargetStato = "Incassato" | "Pagato" | "Da incassare";

/**
 * Riporta contratti da Archivio (isHistorical) o KO in Provvigioni attive.
 */
export async function restoreContractsToProvvigioniAction(formData: FormData): Promise<{
  ok: true;
  count: number;
} | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!hasPermission(session.role, "contracts.edit_all")) {
      return { ok: false, error: "Permesso negato" };
    }

    const rawIds = String(formData.get("contractIds") ?? "");
    const target = String(formData.get("targetStato") ?? "Pagato").trim() as RestoreTargetStato;
    if (!["Incassato", "Pagato", "Da incassare"].includes(target)) {
      return { ok: false, error: "Stato destinazione non valido" };
    }

    const ids = rawIds
      .split(/[,|\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) return { ok: false, error: "Nessun contratto selezionato" };
    if (ids.length > 200) return { ok: false, error: "Max 200 contratti per volta" };

    let count = 0;
    for (const id of ids) {
      const contract = await prisma.contract.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          status: true,
          collectionDate: true,
          isHistorical: true,
          client: { select: { type: true } },
          commission: {
            select: { id: true, expected: true, received: true, paid: true },
          },
        },
      });
      if (!contract) continue;

      let commissionId = contract.commission?.id;
      let expected = Number(contract.commission?.expected ?? 0) || 0;
      if (!commissionId) {
        expected = defaultCommissionExpected(contract.client.type);
        const created = await prisma.commission.create({
          data: {
            contractId: id,
            expected,
            accrued: 0,
            received: 0,
            paid: 0,
          },
          select: { id: true },
        });
        commissionId = created.id;
      }

      if (target === "Pagato") {
        const received =
          Number(contract.commission?.received ?? 0) || expected || 0;
        const paid = Number(contract.commission?.paid ?? 0) || 0;
        await prisma.commission.update({
          where: { id: commissionId },
          data: {
            received: received > 0 ? received : expected,
            paid: Math.max(paid, received > 0 ? received : expected),
            accrued: received > 0 ? received : expected,
          },
        });
        await prisma.contract.update({
          where: { id },
          data: {
            status: "PROVVIGIONE_LIQUIDATA",
            paymentStatus: "Incassato",
            collectionDate: contract.collectionDate ?? new Date(),
            ...reactivateContractFields(),
          },
        });
      } else if (target === "Incassato") {
        const received =
          Number(contract.commission?.received ?? 0) || expected || 0;
        await prisma.commission.update({
          where: { id: commissionId },
          data: {
            received: received > 0 ? received : expected,
            accrued: received > 0 ? received : expected,
          },
        });
        await prisma.contract.update({
          where: { id },
          data: {
            status: "PAGATO_DAL_FORNITORE",
            paymentStatus: "Incassato",
            collectionDate: contract.collectionDate ?? new Date(),
            ...reactivateContractFields(),
          },
        });
      } else {
        await prisma.contract.update({
          where: { id },
          data: {
            status: "IN_ATTESA_PAGAMENTO",
            paymentStatus: "Da incassare",
            collectionDate: null,
            ...reactivateContractFields(),
          },
        });
      }

      await syncRecurringMonthsForContract(id).catch(() => undefined);
      await writeAuditLog({
        userId: session.id,
        action: "UPDATE",
        entity: "Contract",
        entityId: id,
        details: {
          field: "restore_to_provvigioni",
          to: target,
          source: "archivio",
        },
      });
      count += 1;
    }

    revalidatePath("/archivio");
    revalidatePath("/provvigioni");
    revalidatePath("/");
    revalidatePath("/contratti");
    return { ok: true, count };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Ripristino non riuscito",
    };
  }
}
