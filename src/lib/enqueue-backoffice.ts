import { prisma } from "@/lib/prisma";

const STATUSES_TO_LAVORAZIONE = new Set([
  "BOZZA",
  "INSERITO",
  "DOCUMENTAZIONE_COMPLETA",
  "DOCUMENTAZIONE_INCOMPLETA",
]);

/**
 * Mette i contratti in coda lavorazione e li assegna al back office
 * (visibili in /lavorazione). Lo stato diventa IN_LAVORAZIONE solo se
 * era ancora bozza/inserito.
 */
export async function enqueueContractsForBackoffice(opts: {
  contractIds: string[];
  userId: string;
}): Promise<void> {
  for (const id of opts.contractIds) {
    const contract = await prisma.contract.findUnique({
      where: { id },
      select: {
        status: true,
        sendToMaster: true,
        assignedToMaster: true,
      },
    });
    if (!contract) continue;

    const nextStatus = STATUSES_TO_LAVORAZIONE.has(contract.status)
      ? "IN_LAVORAZIONE"
      : contract.status;

    await prisma.contract.update({
      where: { id },
      data: {
        sendToMaster: true,
        assignedToMaster: true,
        toWork: true,
        ...(nextStatus !== contract.status ? { status: nextStatus } : {}),
      },
    });

    if (nextStatus !== contract.status) {
      await prisma.contractStatusHistory.create({
        data: {
          contractId: id,
          fromStatus: contract.status,
          toStatus: nextStatus,
          changedById: opts.userId,
          changeReason: "Invio al back office",
          note: "Contratto messo in lavorazione e assegnato al back office del fornitore",
        },
      });
    }
  }
}
