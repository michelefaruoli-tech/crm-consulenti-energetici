import "dotenv/config";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import { syncRecurringMonthsForContract } from "../src/lib/recurring-sync";

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

async function main() {
  const rows = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      isHistorical: false,
      recurrence: { equals: "R" },
    },
    select: { id: true },
  });
  console.log("annual contracts", rows.length);
  for (const r of rows) {
    await syncRecurringMonthsForContract(r.id);
  }
  console.log("synced");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
