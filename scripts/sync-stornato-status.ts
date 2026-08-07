/**
 * Allinea contratti con stornoDate → stato STORNATO.
 * Uso: npx tsx scripts/sync-stornato-status.ts
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

async function main() {
  const list = await prisma.commission.findMany({
    where: { stornoDate: { not: null } },
    select: {
      contractId: true,
      stornoDate: true,
      stornoAmount: true,
      contract: {
        select: {
          status: true,
          client: {
            select: { companyName: true, firstName: true, lastName: true },
          },
        },
      },
    },
  });

  console.log({ storni: list.length });
  let updated = 0;
  for (const c of list) {
    const name =
      c.contract.client.companyName ||
      [c.contract.client.lastName, c.contract.client.firstName]
        .filter(Boolean)
        .join(" ");
    console.log(
      name,
      c.contract.status,
      c.stornoDate?.toISOString().slice(0, 10),
      Number(c.stornoAmount),
    );
    if (
      ["STORNATO", "KO", "CHIUSO", "ANNULLATO"].includes(c.contract.status)
    ) {
      continue;
    }
    await prisma.contract.update({
      where: { id: c.contractId },
      data: { status: "STORNATO", paymentStatus: "Stornato" },
    });
    updated += 1;
    console.log("  -> STORNATO");
  }
  console.log({ updated });
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
