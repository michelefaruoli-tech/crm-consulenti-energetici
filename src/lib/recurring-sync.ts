import { prisma } from "@/lib/prisma";
import { isRecurring, monthsBetween, normalizeRecurrence, toPeriod } from "@/lib/recurring";
import { computeSupplyStartDate } from "@/lib/supply-dates";

/**
 * Per contratti ricorrenti genera i mesi di competenza da inizio fornitura → oggi.
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
      operationType: true,
      collectionDate: true,
      status: true,
      commission: { select: { expected: true } },
    },
  });
  if (!contract) return;

  // Allinea etichetta R/G (es. «R » → «Ricorrente») così i filtri scheda funzionano
  const normalized = normalizeRecurrence(contract.recurrence);
  if (contract.recurrence?.trim() !== normalized) {
    await prisma.contract.update({
      where: { id: contractId },
      data: { recurrence: normalized },
    });
    contract.recurrence = normalized;
  }

  if (!isRecurring(contract.recurrence)) return;

  if (
    contract.status === "CHIUSO" ||
    contract.status === "ANNULLATO" ||
    contract.status === "KO"
  ) {
    // Neon HTTP: niente updateMany (usa transaction interna). Chiudi uno per uno.
    const open = await prisma.recurringMonth.findMany({
      where: { contractId, status: { in: ["PENDING", "MISSING"] } },
      select: { id: true },
    });
    for (const row of open) {
      await prisma.recurringMonth.update({
        where: { id: row.id },
        data: { status: "CLOSED" },
      });
    }
    return;
  }

  // Stessa logica della scheda: supplyStart salvato, altrimenti calcolato da inserimento+operazione
  const startDate =
    contract.supplyStartDate ??
    computeSupplyStartDate(contract.insertionDate, contract.operationType);
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

/** Normalizza etichette R e sync mesi per tutti i ricorrenti (o un collaboratore). */
export async function syncAllRecurringMonths(collaboratorId?: string): Promise<number> {
  const contracts = await prisma.contract.findMany({
    where: {
      isHistorical: false,
      deletedAt: null,
      ...(collaboratorId ? { collaboratorId } : {}),
      OR: [
        { recurrence: { equals: "R", mode: "insensitive" } },
        { recurrence: { equals: "Ricorrente", mode: "insensitive" } },
        { recurrence: { contains: "ricor", mode: "insensitive" } },
        { recurrence: { contains: "mensil", mode: "insensitive" } },
        // Varianti corte / spazi che altrimenti non entrano nel filtro scheda
        { recurrence: { startsWith: "R", mode: "insensitive" } },
      ],
    },
    select: { id: true, recurrence: true },
  });

  // Passata extra: etichette strane (solo «r», spazi) non catturate da startsWith se minuscole già ok
  const maybeR = await prisma.contract.findMany({
    where: {
      isHistorical: false,
      deletedAt: null,
      ...(collaboratorId ? { collaboratorId } : {}),
      recurrence: { not: null },
      id: { notIn: contracts.map((c) => c.id) },
    },
    select: { id: true, recurrence: true },
    take: 2000,
  });
  const extra = maybeR.filter((c) => isRecurring(c.recurrence));
  const all = [...contracts, ...extra];
  const seen = new Set<string>();
  // Cap: poche sync per richiesta → non martella il DB ad ogni apertura Provvigioni
  const MAX_PER_RUN = 12;

  for (const c of all) {
    if (seen.size >= MAX_PER_RUN) break;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    await syncRecurringMonthsForContract(c.id);
  }
  return seen.size;
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
    take: 40,
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
    take: 200,
  });
}
