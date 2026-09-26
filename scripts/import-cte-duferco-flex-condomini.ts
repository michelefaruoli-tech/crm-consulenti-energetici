/**
 * Upsert CTE Duferco Flex Condomini (8 luce + 10 gas) in catalogo CONDOMINI.
 * Uso:
 *   npx tsx scripts/import-cte-duferco-flex-condomini.ts --dry
 *   npx tsx scripts/import-cte-duferco-flex-condomini.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import { allDufercoFlexCondominiOffers } from "../src/lib/cte-duferco-flex-condomini";
import { upsertListinoOffers } from "../src/lib/cte-listino-shared";

const DRY = process.argv.includes("--dry");

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL mancante (.env.local)");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaNeonHttp(process.env.DATABASE_URL, {
      arrayMode: false,
      fullResults: true,
    }),
  });

  try {
    const suppliers = await prisma.supplier.findMany({
      where: { active: true },
      select: { id: true, name: true, code: true },
    });
    const rows = allDufercoFlexCondominiOffers();
    console.log({ dry: DRY, offers: rows.length, suppliers: suppliers.length });
    if (DRY) {
      for (const row of rows) {
        console.log(
          `- ${row.category} ${row.utility} ${row.priceKind} ${row.offerName} spread=${row.spread} ccv=${row.ccvAnnual} validTo=${row.validTo}`,
        );
      }
      return;
    }

    const result = await upsertListinoOffers(prisma, suppliers, rows);
    console.log(result);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
