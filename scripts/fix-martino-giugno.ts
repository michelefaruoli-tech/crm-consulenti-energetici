import "dotenv/config";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

const PERIOD = "2026-06";

async function markPaid(contractId: string, amount = 4) {
  const ex = await prisma.recurringMonth.findUnique({
    where: { contractId_period: { contractId, period: PERIOD } },
  });
  if (ex?.status === "PAID") return;
  if (ex) {
    await prisma.recurringMonth.update({
      where: { id: ex.id },
      data: { status: "PAID", paidAt: new Date(), settledPeriod: PERIOD, amount },
    });
  } else {
    await prisma.recurringMonth.create({
      data: {
        contractId,
        period: PERIOD,
        status: "PAID",
        paidAt: new Date(),
        settledPeriod: PERIOD,
        amount,
      },
    });
  }
  await prisma.contract.update({
    where: { id: contractId },
    data: {
      status: "PAGATO_DAL_FORNITORE",
      paymentStatus: "Incassato",
      collectionDate: new Date(2026, 5, 1),
      recurrence: "Ricorrente",
    },
  });
}

async function main() {
  // MARTINO ALESSANDRO corretto
  await prisma.contract.update({
    where: { id: "cms03dmyc00ce04l9rvnezk3i" },
    data: { podPdr: "IT001E11522504", pod: "IT001E11522504" },
  });
  await markPaid("cms03dmyc00ce04l9rvnezk3i", 4);
  console.log("✓ MARTINO ALESSANDRO IT001E11522504");

  // Duplicato MARTINO ALESSANDRO con POD sbagliato
  await prisma.contract.update({
    where: { id: "cms388qqq0001lcglm8d5lt5q" },
    data: {
      deletedAt: new Date(),
      internalNotes: "Duplicato MARTINO ALESSANDRO (fix giugno)",
    },
  });
  console.log("🗑 duplicato MARTINO ALESSANDRO");

  // Duplicato MARTINO ALFONSO
  await prisma.contract.update({
    where: { id: "cms03fz9s00um04ib31khjtot" },
    data: {
      deletedAt: new Date(),
      internalNotes: "Duplicato MARTINO ALFONSO",
    },
  });
  console.log("🗑 duplicato MARTINO ALFONSO");
}

main().finally(() => prisma.$disconnect());
