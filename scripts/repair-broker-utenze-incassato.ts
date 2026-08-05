/**
 * Ripara contratti importati dal rendiconto Broker Utenze luglio 2026:
 * devono risultare Incassato (PAGATO_DAL_FORNITORE), non Pagato (PROVVIGIONE_LIQUIDATA).
 *
 * Uso: npx tsx scripts/repair-broker-utenze-incassato.ts
 *      DRY=1 npx tsx scripts/repair-broker-utenze-incassato.ts  (solo anteprima)
 */
import "dotenv/config";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});
const DRY = process.env.DRY === "1";
const COLLECTION = new Date("2026-07-01T12:00:00.000Z");
const SETTLED = "2026-07";
const BROKER_NOTE = "Broker Utenze rendiconto 8800";

async function main() {
  const brokerMonths = await prisma.recurringMonth.findMany({
    where: { note: { contains: BROKER_NOTE } },
    select: { contractId: true },
    distinct: ["contractId"],
  });
  const contractIds = brokerMonths.map((m) => m.contractId);

  if (contractIds.length === 0) {
    console.log("Nessun contratto trovato con nota Broker Utenze.");
    await prisma.$disconnect();
    return;
  }

  const contracts = await prisma.contract.findMany({
    where: { id: { in: contractIds } },
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      collectionDate: true,
      client: {
        select: { companyName: true, firstName: true, lastName: true },
      },
      commission: { select: { id: true, paid: true, received: true } },
      recurringMonths: {
        where: { note: { contains: BROKER_NOTE } },
        select: { id: true, period: true, status: true },
      },
    },
  });

  console.log(`Contratti Broker trovati: ${contracts.length}`);
  let fixed = 0;

  for (const c of contracts) {
    const name =
      c.client.companyName ||
      [c.client.lastName, c.client.firstName].filter(Boolean).join(" ");
    const wasLiquidated = c.status === "PROVVIGIONE_LIQUIDATA";
    const wrongPayment = c.paymentStatus === "Pagato";
    const needsFix =
      wasLiquidated ||
      wrongPayment ||
      c.status !== "PAGATO_DAL_FORNITORE" ||
      !c.collectionDate;

    if (!needsFix) {
      console.log(`  OK  ${name.slice(0, 40)} (${c.status})`);
      continue;
    }

    console.log(
      `  FIX ${name.slice(0, 40)}: ${c.status}/${c.paymentStatus} → PAGATO_DAL_FORNITORE/Incassato`,
    );

    if (DRY) {
      fixed++;
      continue;
    }

    await prisma.contract.update({
      where: { id: c.id },
      data: {
        status: "PAGATO_DAL_FORNITORE",
        paymentStatus: "Incassato",
        collectionDate: COLLECTION,
      },
    });

    if (c.commission && wasLiquidated && Number(c.commission.paid ?? 0) > 0) {
      await prisma.commission.update({
        where: { id: c.commission.id },
        data: { paid: 0 },
      });
    }

    for (const rm of c.recurringMonths) {
      if (rm.status === "LIQUIDATED") {
        await prisma.recurringMonth.update({
          where: { id: rm.id },
          data: { status: "PAID", settledPeriod: SETTLED },
        });
      }
    }

    fixed++;
  }

  console.log(DRY ? `Anteprima: ${fixed} contratti da sistemare` : `Sistemati: ${fixed}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
