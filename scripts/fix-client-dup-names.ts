/**
 * Pulisce clienti PRIVATO con firstName === lastName (es. «ALVINO ALVINO»).
 * Uso: npx tsx scripts/fix-client-dup-names.ts
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
  const clients = await prisma.client.findMany({
    where: {
      deletedAt: null,
      type: "PRIVATO",
      firstName: { not: null },
      lastName: { not: null },
    },
    select: { id: true, firstName: true, lastName: true },
  });

  let fixed = 0;
  for (const c of clients) {
    const first = (c.firstName ?? "").trim();
    const last = (c.lastName ?? "").trim();
    if (!first || !last) continue;
    if (first.localeCompare(last, "it", { sensitivity: "accent" }) !== 0) {
      continue;
    }
    await prisma.client.update({
      where: { id: c.id },
      data: { firstName: null },
    });
    fixed++;
    if (fixed <= 20) console.log(`fix ${last} ${first} → ${last}`);
  }
  console.log(`Puliti: ${fixed}/${clients.length} clienti con nome=cognome`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
