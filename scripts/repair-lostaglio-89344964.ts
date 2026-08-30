/**
 * Corregge IT001E89344964: ingresso 01/08/2026, non incassabile a luglio.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";

const CONTRACT_ID = "cmry23ert008w7ogllp4feitt";
const POD = "IT001E89344964";

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

async function main() {
  const before = await prisma.contract.findUnique({
    where: { id: CONTRACT_ID },
    select: {
      podPdr: true,
      supplyStartDate: true,
      collectionDate: true,
      status: true,
      paymentStatus: true,
      recurringMonths: {
        where: { period: { in: ["2026-07", "2026-08"] } },
        select: { period: true, status: true },
      },
    },
  });
  console.log("Prima:", JSON.stringify(before, null, 2));

  if (!before || before.podPdr !== POD) {
    throw new Error("Contratto non trovato o POD non corrisponde");
  }

  await prisma.contract.update({
    where: { id: CONTRACT_ID },
    data: {
      paymentStatus: "Da incassare",
      status: "IN_ATTESA_PAGAMENTO",
      collectionDate: null,
    },
  });

  const deletedLug = await prisma.recurringMonth.deleteMany({
    where: { contractId: CONTRACT_ID, period: "2026-07" },
  });

  const after = await prisma.contract.findUnique({
    where: { id: CONTRACT_ID },
    select: {
      podPdr: true,
      supplyStartDate: true,
      collectionDate: true,
      status: true,
      paymentStatus: true,
      recurringMonths: {
        where: { period: { in: ["2026-07", "2026-08"] } },
        select: { period: true, status: true },
      },
    },
  });

  console.log("Mesi lug eliminati:", deletedLug.count);
  console.log("Dopo:", JSON.stringify(after, null, 2));
}

main().finally(() => prisma.$disconnect());
