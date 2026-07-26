/**
 * Helios: tutti i contratti → Ricorrente mensile.
 * - PRIVATO (domestico) → 4 €/mese
 * - AZIENDA (business) → 6 €/mese
 * Genera RecurringMonth dall'ingresso fornitura (mesi PAID/CLOSED/ERROR_UNPAID restano).
 *
 * Idempotente: si può rilanciare. Non usa $transaction (Neon HTTP).
 *
 * Uso: npx tsx scripts/fix-helios-ricorrente.ts
 */
import "dotenv/config";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  isRecurring,
  monthsBetween,
  normalizeRecurrence,
  toPeriod,
} from "../src/lib/recurring";
import { computeSupplyStartDate } from "../src/lib/supply-dates";

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

const AMOUNT_PRIVATO = 4;
const AMOUNT_AZIENDA = 6;

/** Sync mesi senza transaction (stessa logica di recurring-sync.ts). */
async function syncMonthsInline(contractId: string): Promise<number> {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      recurrence: true,
      insertionDate: true,
      supplyStartDate: true,
      operationType: true,
      status: true,
      commission: { select: { expected: true } },
    },
  });
  if (!contract) return 0;

  const normalized = normalizeRecurrence(contract.recurrence);
  if (contract.recurrence?.trim() !== normalized) {
    await prisma.contract.update({
      where: { id: contractId },
      data: { recurrence: normalized },
    });
    contract.recurrence = normalized;
  }

  if (!isRecurring(contract.recurrence)) return 0;

  if (
    contract.status === "CHIUSO" ||
    contract.status === "ANNULLATO" ||
    contract.status === "KO"
  ) {
    // Neon HTTP: niente updateMany
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
    return 0;
  }

  const startDate =
    contract.supplyStartDate ??
    computeSupplyStartDate(contract.insertionDate, contract.operationType);
  const start = toPeriod(startDate);
  const now = toPeriod(new Date());
  const periods = monthsBetween(start, now);
  const amount = Number(contract.commission?.expected ?? 0) || null;

  let touched = 0;
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
        touched++;
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
    touched++;
  }
  return touched;
}

async function main() {
  const helios = await prisma.supplier.findFirst({
    where: { name: { equals: "Helios", mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!helios) throw new Error("Fornitore Helios non trovato");

  const contracts = await prisma.contract.findMany({
    where: {
      supplierId: helios.id,
      deletedAt: null,
      isHistorical: false,
    },
    select: {
      id: true,
      recurrence: true,
      status: true,
      supplyStartDate: true,
      client: { select: { type: true } },
      commission: { select: { id: true, expected: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Helios attivi da aggiornare: ${contracts.length}`);

  let updated = 0;
  let syncOk = 0;
  let syncFail = 0;
  let monthsTouched = 0;
  let priv = 0;
  let az = 0;

  for (const c of contracts) {
    const expected =
      c.client.type === "AZIENDA" ? AMOUNT_AZIENDA : AMOUNT_PRIVATO;
    if (c.client.type === "AZIENDA") az++;
    else priv++;

    await prisma.contract.update({
      where: { id: c.id },
      data: { recurrence: "Ricorrente" },
    });

    if (c.commission?.id) {
      await prisma.commission.update({
        where: { id: c.commission.id },
        data: { expected },
      });
    } else {
      await prisma.commission.create({
        data: { contractId: c.id, expected },
      });
    }

    updated++;

    try {
      monthsTouched += await syncMonthsInline(c.id);
      syncOk++;
    } catch (e) {
      syncFail++;
      console.error(`sync fail ${c.id}`, e instanceof Error ? e.message : e);
    }

    if (updated % 25 === 0) {
      console.log(`… ${updated}/${contracts.length}`);
    }
  }

  // Listino Helios per i prossimi contratti
  const rules = await prisma.commissionRule.findMany({
    where: { supplierId: helios.id },
    select: {
      id: true,
      name: true,
      clientSegment: true,
    },
  });
  for (const rule of rules) {
    const isBusiness =
      /business|azienda/i.test(rule.clientSegment ?? "") ||
      /business|azienda/i.test(rule.name ?? "");
    const want = isBusiness ? AMOUNT_AZIENDA : AMOUNT_PRIVATO;
    await prisma.commissionRule.update({
      where: { id: rule.id },
      data: {
        paymentType: "MENSILE",
        gettoneMensile: want,
        fixedAmount: want,
      },
    });
    console.log(
      `listino «${rule.name}» (${rule.clientSegment ?? "—"}): mensile ${want} €`,
    );
  }

  const after = await prisma.contract.findMany({
    where: {
      supplierId: helios.id,
      deletedAt: null,
      isHistorical: false,
    },
    select: {
      status: true,
      recurrence: true,
      client: { select: { type: true } },
      commission: { select: { expected: true } },
      _count: { select: { recurringMonths: true } },
    },
  });

  let okRec = 0;
  let okAmt = 0;
  let withMonths = 0;
  let activeNeedingMonths = 0;
  let activeWithMonths = 0;
  for (const c of after) {
    if (c.recurrence === "Ricorrente") okRec++;
    const exp = Number(c.commission?.expected ?? 0);
    const want = c.client.type === "AZIENDA" ? AMOUNT_AZIENDA : AMOUNT_PRIVATO;
    if (exp === want) okAmt++;
    if (c._count.recurringMonths > 0) withMonths++;
    const closed =
      c.status === "CHIUSO" || c.status === "ANNULLATO" || c.status === "KO";
    if (!closed) {
      activeNeedingMonths++;
      if (c._count.recurringMonths > 0) activeWithMonths++;
    }
  }

  console.log("---");
  console.log(`Aggiornati: ${updated} (PRIVATO ${priv}, AZIENDA ${az})`);
  console.log(
    `Sync mesi ok: ${syncOk}, errori: ${syncFail}, righe mese toccate: ${monthsTouched}`,
  );
  console.log(`Verifica Ricorrente: ${okRec}/${after.length}`);
  console.log(`Verifica importo 4/6: ${okAmt}/${after.length}`);
  console.log(`Con almeno 1 mese: ${withMonths}/${after.length}`);
  console.log(
    `Attivi (non KO/chiusi) con mesi: ${activeWithMonths}/${activeNeedingMonths}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
