/**
 * Imposta ricorrenza annuale (R) per Dolomiti, Sinergy, Duferco.
 * Uso:
 *   npx tsx scripts/set-annual-dolomiti-sinergy-duferco.ts --dry
 *   npx tsx scripts/set-annual-dolomiti-sinergy-duferco.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";

const DRY = process.argv.includes("--dry");

const SUPPLIERS_ANNUAL = ["Dolomiti", "Sinergy", "Duferco"];

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL mancante (.env.local)");
  }

  const contracts = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      isHistorical: false,
      OR: SUPPLIERS_ANNUAL.map((name) => ({
        supplier: { name: { equals: name, mode: "insensitive" as const } },
      })),
      NOT: { recurrence: { equals: "R", mode: "insensitive" } },
    },
    select: {
      id: true,
      recurrence: true,
      supplier: { select: { name: true } },
    },
  });

  const bySupplier: Record<string, number> = {};
  for (const c of contracts) {
    const name = c.supplier.name;
    bySupplier[name] = (bySupplier[name] ?? 0) + 1;
  }

  console.log({
    dry: DRY,
    total: contracts.length,
    bySupplier,
  });

  if (DRY || contracts.length === 0) {
    await prisma.$disconnect();
    return;
  }

  const ids = contracts.map((c) => c.id);
  for (const id of ids) {
    await prisma.contract.update({
      where: { id },
      data: { recurrence: "R" },
    });
  }

  console.log(`Aggiornati ${ids.length} contratti → R (annuale)`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
