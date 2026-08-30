import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

async function main() {
  const pods = ["IT001E89344964", "IT001E71931956"];
  for (const pod of pods) {
    const contracts = await prisma.contract.findMany({
      where: {
        OR: [
          { podPdr: { contains: pod.slice(-8) } },
          { pod: pod },
          { podPdr: pod },
        ],
        deletedAt: null,
      },
      select: {
        id: true,
        podPdr: true,
        pod: true,
        supplyStartDate: true,
        collectionDate: true,
        status: true,
        paymentStatus: true,
        recurrence: true,
        insertionDate: true,
        client: {
          select: { firstName: true, lastName: true, companyName: true },
        },
        recurringMonths: {
          where: { period: { in: ["2026-07", "2026-08"] } },
          select: { period: true, status: true, amount: true, settledPeriod: true, note: true },
        },
      },
    });
    console.log("\n=== POD", pod, "===");
    console.log(JSON.stringify(contracts, null, 2));
  }

  const byName = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      client: {
        OR: [
          { lastName: { contains: "LOSTAGLIO", mode: "insensitive" } },
          { companyName: { contains: "LOSTAGLIO", mode: "insensitive" } },
        ],
      },
      supplier: { name: { contains: "helios", mode: "insensitive" } },
    },
    select: {
      id: true,
      podPdr: true,
      pod: true,
      supplyStartDate: true,
      collectionDate: true,
      status: true,
      paymentStatus: true,
      recurringMonths: {
        orderBy: { period: "desc" },
        take: 6,
        select: { period: true, status: true, settledPeriod: true },
      },
    },
  });
  console.log("\n=== LOSTAGLIO HELIOS ===");
  console.log(JSON.stringify(byName, null, 2));
}

main().finally(() => prisma.$disconnect());
