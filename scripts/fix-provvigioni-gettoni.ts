/**
 * Allinea Pagato/Data e gettoni simbolici:
 * - senza collectionDate → Da incassare
 * - con collectionDate passata → Incassato + gettone 50 (domestico) / 80 (business)
 */
import "dotenv/config";
import ws from "ws";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";

neonConfig.webSocketConstructor = ws;

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const now = new Date();
  const contracts = await prisma.contract.findMany({
    where: { isHistorical: false },
    select: {
      id: true,
      collectionDate: true,
      paymentStatus: true,
      client: { select: { type: true } },
      commission: { select: { id: true, expected: true } },
    },
  });

  let noDate = 0;
  let withDate = 0;

  for (const c of contracts) {
    if (!c.collectionDate) {
      await prisma.contract.update({
        where: { id: c.id },
        data: { paymentStatus: "Da incassare" },
      });
      noDate += 1;
      continue;
    }

    const past = c.collectionDate.getTime() <= now.getTime();
    await prisma.contract.update({
      where: { id: c.id },
      data: { paymentStatus: "Incassato" },
    });

    if (past && c.commission) {
      const amount = c.client.type === "AZIENDA" ? 80 : 50;
      await prisma.commission.update({
        where: { id: c.commission.id },
        data: {
          expected: amount,
          received: amount,
          accrued: amount,
        },
      });
      withDate += 1;
    } else {
      withDate += 1;
    }
  }

  console.log(`senza data → No: ${noDate}`);
  console.log(`con data → Sì (+ gettone 50/80 se passata): ${withDate}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
