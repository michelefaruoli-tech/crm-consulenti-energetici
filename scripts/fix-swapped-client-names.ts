/**
 * Corregge Nome/Cognome invertiti su tutti i clienti PRIVATO.
 * Uso: npx tsx scripts/fix-swapped-client-names.ts
 * Dry-run: npx tsx scripts/fix-swapped-client-names.ts --dry
 */
import "dotenv/config";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import { suggestPersonNameOrder } from "../src/lib/italian-person-name";

const dry = process.argv.includes("--dry");
const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL mancante");
  }

  const clients = await prisma.client.findMany({
    where: {
      deletedAt: null,
      type: "PRIVATO",
      AND: [{ firstName: { not: null } }, { lastName: { not: null } }],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      fiscalCode: true,
    },
  });

  let fixed = 0;
  let skipped = 0;
  const samples: string[] = [];

  for (const c of clients) {
    const suggestion = suggestPersonNameOrder(
      c.firstName,
      c.lastName,
      c.fiscalCode,
    );
    if (!suggestion.swapped || suggestion.confidence === "low") {
      skipped += 1;
      continue;
    }

    const before = `${c.lastName} ${c.firstName}`.trim();
    const after = `${suggestion.lastName} ${suggestion.firstName}`.trim();
    if (samples.length < 50) {
      samples.push(
        `${before} → ${after} [${suggestion.confidence}] ${suggestion.reason}`,
      );
    }

    if (!dry) {
      await prisma.client.update({
        where: { id: c.id },
        data: {
          firstName: suggestion.firstName,
          lastName: suggestion.lastName,
        },
      });
    }
    fixed += 1;
  }

  console.log(
    dry
      ? `DRY-RUN: andrebbero corretti ${fixed} / ${clients.length} (invariati ${skipped})`
      : `Corretti ${fixed} / ${clients.length} (invariati ${skipped})`,
  );
  for (const s of samples) console.log("  ", s);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
