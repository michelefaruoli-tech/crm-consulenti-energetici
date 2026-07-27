/**
 * Passa tutti i contratti «Incassato» (con data incasso) a stato Pagato
 * (PROVVIGIONE_LIQUIDATA) in Provvigioni.
 *
 * Uso: npx tsx scripts/migrate-incassati-to-pagato.ts
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

const KO = ["KO", "ANNULLATO", "CHIUSO"] as const;

async function main() {
  const rows = await prisma.commission.findMany({
    where: {
      contract: {
        deletedAt: null,
        isHistorical: false,
        collectionDate: { not: null },
        status: { notIn: ["PROVVIGIONE_LIQUIDATA", ...KO] },
      },
    },
    select: {
      id: true,
      contractId: true,
      expected: true,
      received: true,
      paid: true,
    },
  });

  console.log(`Contratti incassati da passare a Pagato: ${rows.length}`);

  let updated = 0;
  for (const r of rows) {
    const expected = Number(r.expected ?? 0) || 0;
    let received = Number(r.received ?? 0) || 0;
    const paid = Number(r.paid ?? 0) || 0;

    // Se incassato ma received non valorizzato, allinea a expected
    if (received <= 0 && expected > 0) {
      received = expected;
      await prisma.commission.update({
        where: { id: r.id },
        data: { received },
      });
    }

    const remaining = Math.max(0, received - paid);
    if (remaining > 0) {
      await prisma.commission.update({
        where: { id: r.id },
        data: { paid: paid + remaining },
      });
    }

    await prisma.contract.update({
      where: { id: r.contractId },
      data: { status: "PROVVIGIONE_LIQUIDATA" },
    });
    updated++;
    if (updated <= 15) {
      console.log(`  ok ${r.contractId}`);
    }
  }

  console.log(`Completato: ${updated} contratti → Pagato (PROVVIGIONE_LIQUIDATA)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
