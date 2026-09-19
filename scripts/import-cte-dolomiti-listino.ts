/**
 * Upsert offerte CTE Dolomiti da listino screenshot (solo righe con prezzo).
 * Uso:
 *   npx tsx scripts/import-cte-dolomiti-listino.ts --dry
 *   npx tsx scripts/import-cte-dolomiti-listino.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import { allDolomitiListinoOffers } from "../src/lib/cte-dolomiti-listino";
import { upsertDolomitiListinoOffers } from "../src/lib/cte-dolomiti-upsert";

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
    const dolomiti = suppliers.find((s) => /dolomiti/i.test(s.name) || /dolomiti/i.test(s.code ?? ""));
    if (!dolomiti) {
      throw new Error("Fornitore Dolomiti non trovato in anagrafica");
    }

    const rows = allDolomitiListinoOffers();
    console.log({ dry: DRY, supplier: dolomiti.name, offers: rows.length });
    if (DRY) {
      for (const row of rows) {
        console.log(`- ${row.category} ${row.utility} ${row.priceKind} ${row.offerName}`);
      }
      return;
    }

    const result = await upsertDolomitiListinoOffers(prisma, dolomiti.id);
    console.log(result);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
