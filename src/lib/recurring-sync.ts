import { prisma } from "@/lib/prisma";
import { isRecurring, monthsBetween, toPeriod } from "@/lib/recurring";

function periodToDate(period: string): Date {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

/**
 * Per contratti ricorrenti genera i mesi da inizio → oggi.
 * - mesi <= ultima data incasso nota → PAID
 * - mesi successivi già passati → MISSING (segnalati nei mesi dopo)
 * - mese corrente senza pagamento → PENDING
 * Stati manuali CLOSED / ERROR_UNPAID non vengono sovrascritti.
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
  const lastPaid = contract.collectionDate ? toPeriod(contract.collectionDate) : null;

  // Se esistono mesi PAID, usa il più recente come lastPaid effettivo
  const latestPaidRow = await prisma.recurringMonth.findFirst({
    where: { contractId, status: "PAID" },
    orderBy: { period: "desc" },
  });
  const effectiveLastPaid =
    latestPaidRow && (!lastPaid || latestPaidRow.period > lastPaid)
      ? latestPaidRow.period
      : lastPaid;

  for (const period of periods) {
    const existing = await prisma.recurringMonth.findUnique({
      where: { contractId_period: { contractId, period } },
    });

    if (
      existing &&
      (existing.status === "CLOSED" || existing.status === "ERROR_UNPAID")
    ) {
      continue;
    }
    // Non togliere un PAID manuale
    if (existing?.status === "PAID" && existing.paidAt) {
      continue;
    }

    let status: string;
    if (effectiveLastPaid && period <= effectiveLastPaid) {
      status = "PAID";
    } else if (period < now) {
      status = "MISSING";
    } else {
      status = "PENDING";
    }

    if (existing) {
      await prisma.recurringMonth.update({
        where: { id: existing.id },
        data: {
          status,
          amount: amount ?? existing.amount,
          paidAt: status === "PAID" ? existing.paidAt ?? periodToDate(period) : null,
        },
      });
    } else {
      await prisma.recurringMonth.create({
        data: {
          contractId,
          period,
          status,
          amount,
          paidAt: status === "PAID" ? periodToDate(period) : null,
        },
      });
    }
  }
}

export async function syncAllRecurringMonths(collaboratorId?: string): Promise<number> {
  const contracts = await prisma.contract.findMany({
    where: {
      isHistorical: false,
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
