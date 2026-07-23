/**
 * Calcola e salva supplyStartDate su tutti i contratti esistenti.
 */
import "dotenv/config";
import ws from "ws";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import { computeSupplyStartDate, normalizeOperationType } from "../src/lib/supply-dates";

neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL mancante");

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString }),
});

async function main() {
  const contracts = await prisma.contract.findMany({
    select: { id: true, insertionDate: true, operationType: true },
  });

  let updated = 0;
  for (const c of contracts) {
    const op = normalizeOperationType(c.operationType);
    const supplyStartDate = computeSupplyStartDate(c.insertionDate, op);
    await prisma.contract.update({
      where: { id: c.id },
      data: {
        operationType: c.operationType ? op : "CAMBIO",
        supplyStartDate,
      },
    });
    updated += 1;
  }
  console.log(`done — supplyStartDate aggiornata su ${updated} contratti`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
