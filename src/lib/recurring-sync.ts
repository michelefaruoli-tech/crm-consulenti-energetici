import { prisma } from "@/lib/prisma";
import { isRecurring, monthsBetween, toPeriod } from "@/lib/recurring";

/**
 * Per contratti ricorrenti genera i mesi di competenza da inizio → oggi.
 *
 * Fonte di verità sullo stato = riga RecurringMonth (non collectionDate).
 * - PAID / CLOSED / ERROR_UNPAID esistenti non vengono sovrascritti
 * - mesi passati senza pagamento → MISSING
 * - mese corrente → PENDING
 *
 * Nota: non usare collectionDate per marcare “pagato fino a X”, altrimenti
 * un bonifico di luglio segnato come luglio marcherebbe anche aprile–giugno.
 */
export async function syncRecurringMonthsForContract(contractId: string): Promise<void> {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      recurrence: true,
      insertionDate: true,
      supplyStartDate: true,
      collectionDate: true,
      status: true,
      commission: { select: { expected: true } },
    },
  });
  if (!contract || !isRecurring(contract.recurrence)) return;

  if (contract.status === "CHIUSO" || contract.status === "ANNULLATO") {
    await prisma.recurringMonth.updateMany({
      where: { contractId, status: { in: ["PENDING", "MISSING"] } },
      data: { status: "CLOSED" },
    });
    return;
  }

  const startDate =
    contract.supplyStartDate ?? contract.collectionDate ?? contract.insertionDate;
  const start = toPeriod(startDate);
  const now = toPeriod(new Date());
  const periods = monthsBetween(start, now);
  const amount = Number(contract.commission?.expected ?? 0) || null;

  for (const period of periods) {
    const existing = await prisma.recurringMonth.findUnique({
      where: { contractId_period: { contractId, period } },
    });

    if (
      existing &&
      (existing.status === "CLOSED" ||
        existing.status === "ERROR_UNPAID" ||
        existing.status === "PAID")
    ) {
      // Aggiorna solo amount se manca
      if (amount != null && existing.amount == null) {
        await prisma.recurringMonth.update({
          where: { id: existing.id },
          data: { amount },
        });
      }
      continue;
    }

    const status = period < now ? "MISSING" : "PENDING";

    if (existing) {
      await prisma.recurringMonth.update({
        where: { id: existing.id },
        data: {
          status,
          amount: amount ?? existing.amount,
          paidAt: null,
        },
      });
    } else {
      await prisma.recurringMonth.create({
        data: {
          contractId,
          period,
          status,
          amount,
          paidAt: null,
        },
      });
    }
  }
}

export async function syncAllRecurringMonths(collaboratorId?: string): Promise<number> {
  const contracts = await prisma.contract.findMany({
    where: {
      isHistorical: false,
      deletedAt: null,
      ...(collaboratorId ? { collaboratorId } : {}),
      OR: [
        { recurrence: { contains: "Ricor", mode: "insensitive" } },
        { recurrence: { contains: "mensil", mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });

  for (const c of contracts) {
    await syncRecurringMonthsForContract(c.id);
  }
  return contracts.length;
}

export async function getMissingRecurringAlerts(collaboratorId?: string) {
  return prisma.recurringMonth.findMany({
    where: {
      status: "MISSING",
      contract: {
        isHistorical: false,
        deletedAt: null,
        ...(collaboratorId ? { collaboratorId } : {}),
      },
    },
    include: {
      contract: {
        select: {
          id: true,
          podPdr: true,
          recurrence: true,
          client: {
            select: {
              type: true,
              firstName: true,
              lastName: true,
              companyName: true,
            },
          },
          supplier: { select: { name: true } },
        },
      },
    },
    orderBy: [{ period: "asc" }],
    take: 300,
  });
}

/** Mesi pagati in un certo rendiconto (es. bonifico di luglio). */
export async function getSettledRecurringForPeriod(
  settledPeriod: string,
  collaboratorId?: string,
) {
  return prisma.recurringMonth.findMany({
    where: {
      status: "PAID",
      settledPeriod,
      contract: {
        isHistorical: false,
        deletedAt: null,
        ...(collaboratorId ? { collaboratorId } : {}),
      },
    },
    include: {
      contract: {
        select: {
          id: true,
          podPdr: true,
          collaborator: { select: { name: true } },
          client: {
            select: {
              type: true,
              firstName: true,
              lastName: true,
              companyName: true,
            },
          },
          supplier: { select: { name: true } },
        },
      },
    },
    orderBy: [{ period: "asc" }],
  });
}
