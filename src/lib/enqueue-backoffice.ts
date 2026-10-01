import { prisma } from "@/lib/prisma";
import { SEND_TO_BACKOFFICE_STATUS } from "@/lib/contract-bo-flow";
import { syncRecurringMonthsForContract } from "@/lib/recurring-sync";

const STATUSES_TO_LAVORAZIONE = new Set([
  "BOZZA",
  "INSERITO",
  "DOCUMENTAZIONE_COMPLETA",
  "DOCUMENTAZIONE_INCOMPLETA",
  "DA_CONTROLLARE",
  "DA_LAVORARE",
]);

export type EnqueueBackofficeItemResult = {
  contractId: string;
  previousStatus: string;
  status: string;
  queued: boolean;
};

/**
 * Mette i contratti in coda lavorazione (IN_LAVORAZIONE se ancora pre-BO)
 * e li marca sendToMaster / assignedToMaster / toWork.
 *
 * Sempre: la pratica resta tracciata e visibile in /lavorazione e nel
 * percorso Provvigioni — anche se non c’è destinatario BO dedicato
 * (es. Serviren senza UserSupplierScope). L’avviso destinazione è a carico
 * del chiamante (notify-batch / UI).
 *
 * Dopo l’enqueue sincronizza le rate ricorrenti (idempotente): le bozze
 * salvate e poi inviate al BO non passavano da `createContract` con
 * `draft=false`, quindi restavano senza RecurringMonth e fuori Provvigioni.
 */
export async function enqueueContractsForBackoffice(opts: {
  contractIds: string[];
  userId: string;
  note?: string;
}): Promise<EnqueueBackofficeItemResult[]> {
  const now = new Date();
  const results: EnqueueBackofficeItemResult[] = [];

  for (const id of opts.contractIds) {
    const contract = await prisma.contract.findUnique({
      where: { id },
      select: {
        status: true,
        sendToMaster: true,
        assignedToMaster: true,
        sentToMasterAt: true,
      },
    });
    if (!contract) {
      results.push({
        contractId: id,
        previousStatus: "",
        status: "",
        queued: false,
      });
      continue;
    }

    const nextStatus = STATUSES_TO_LAVORAZIONE.has(contract.status)
      ? SEND_TO_BACKOFFICE_STATUS
      : contract.status === "IN_LAVORAZIONE"
        ? contract.status
        : contract.status;

    // Se già oltre la fase lavorazione (es. ATTIVATO), non forzare regressione
    // di stato ma assicuriamo i flag coda se ancora pre-lavorazione.
    const forceLavorazione = STATUSES_TO_LAVORAZIONE.has(contract.status);

    await prisma.contract.update({
      where: { id },
      data: {
        sendToMaster: true,
        assignedToMaster: true,
        toWork: true,
        ...(contract.sentToMasterAt ? {} : { sentToMasterAt: now }),
        ...(forceLavorazione && nextStatus !== contract.status
          ? { status: nextStatus }
          : {}),
      },
    });

    const finalStatus = forceLavorazione ? nextStatus : contract.status;

    if (finalStatus !== contract.status) {
      await prisma.contractStatusHistory.create({
        data: {
          contractId: id,
          fromStatus: contract.status,
          toStatus: finalStatus,
          changedById: opts.userId,
          changeReason: "Invio al back office",
          note:
            opts.note?.trim() ||
            "Contratto messo in lavorazione (IN_LAVORAZIONE) e messo in coda Back Office",
        },
      });
    } else if (!contract.sendToMaster || !contract.assignedToMaster) {
      await prisma.contractStatusHistory.create({
        data: {
          contractId: id,
          fromStatus: contract.status,
          toStatus: contract.status,
          changedById: opts.userId,
          changeReason: "Invio al back office",
          note:
            opts.note?.trim() ||
            "Pratica assegnata / reinviata in coda Back Office (stato invariato)",
        },
      });
    }

    // Rate Provvigioni subito all’invio BO (anche da BOZZA / reinoltro).
    try {
      await syncRecurringMonthsForContract(id);
    } catch (e) {
      console.error("[enqueueContractsForBackoffice] syncRecurring", id, e);
    }

    results.push({
      contractId: id,
      previousStatus: contract.status,
      status: finalStatus,
      queued: true,
    });
  }

  return results;
}
