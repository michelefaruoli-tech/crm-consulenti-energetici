/**
 * Duferco → ricorrente annuale (R / 13° mese).
 *
 * - Solo fornitore Duferco (contains, case-insensitive)
 * - Solo contratti non in cestino (`deletedAt: null`)
 * - Già R: non toccati
 * - UT / M / altro: `recurrenceWriteData("R")` (entrambi i campi)
 * - Non modifica collaboratore, fornitore, importi, POD, stati liquidati
 * - Dopo: sync rate annuali dovute (idempotente; non crea doppie UT)
 *
 * Uso:
 *   npx tsx scripts/set-duferco-annual-r.ts --dry
 *   npx tsx scripts/set-duferco-annual-r.ts --apply
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import { recurrenceWriteData } from "../src/lib/recurring";
import { syncRecurringMonthsForContract } from "../src/lib/recurring-sync";

const APPLY = process.argv.includes("--apply");
const DRY = !APPLY || process.argv.includes("--dry");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL mancante");
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL, {
    arrayMode: false,
    fullResults: true,
  }),
});

const DUFERCO_WHERE = {
  deletedAt: null as null,
  supplier: { name: { contains: "duferco", mode: "insensitive" as const } },
};

async function countByKind() {
  const rows = await prisma.contract.groupBy({
    by: ["recurrenceKind"],
    where: DUFERCO_WHERE,
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (const r of rows) {
    out[r.recurrenceKind ?? "null"] = r._count._all;
  }
  return out;
}

async function main() {
  const before = await countByKind();
  const total = Object.values(before).reduce((a, b) => a + b, 0);

  const toConvert = await prisma.contract.findMany({
    where: {
      ...DUFERCO_WHERE,
      NOT: { recurrenceKind: "R" },
    },
    select: {
      id: true,
      recurrence: true,
      recurrenceKind: true,
      isHistorical: true,
      status: true,
      paymentStatus: true,
      collectionDate: true,
      supplier: { select: { name: true } },
      _count: { select: { recurringMonths: true } },
    },
    orderBy: { id: "asc" },
  });

  const alreadyR = before.R ?? 0;
  const skipped: Array<{ id: string; reason: string }> = [];
  // Nessuno saltato a priori: tutti i non-R Duferco attivi vanno a R.
  // Teniamo l'array per eventuali skip futuri / report.

  console.log(
    JSON.stringify(
      {
        mode: DRY ? "dry" : "apply",
        totalActive: total,
        before,
        alreadyR,
        toConvert: toConvert.length,
        byKindBeforeConvert: toConvert.reduce(
          (acc, c) => {
            const k = c.recurrenceKind ?? "null";
            acc[k] = (acc[k] ?? 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        ),
        historicalAmongConvert: toConvert.filter((c) => c.isHistorical).length,
      },
      null,
      2,
    ),
  );

  if (DRY) {
    console.log(
      `[dry] convertirei ${toConvert.length} contratti Duferco → R; già R: ${alreadyR}`,
    );
    await prisma.$disconnect();
    return;
  }

  const write = recurrenceWriteData("R");
  let converted = 0;
  let synced = 0;
  let syncErrors = 0;

  for (const c of toConvert) {
    await prisma.contract.update({
      where: { id: c.id },
      data: write,
    });
    converted++;

    try {
      await syncRecurringMonthsForContract(c.id);
      synced++;
    } catch (e) {
      syncErrors++;
      console.error(
        `[sync err] ${c.id}`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  const after = await countByKind();
  const utLeft = after.UT ?? 0;
  const mLeft = after.M ?? 0;

  const summary = {
    mode: "apply",
    before,
    after,
    converted,
    alreadyR,
    synced,
    syncErrors,
    skipped,
    utLeft,
    mLeft,
    ok: utLeft === 0 && mLeft === 0,
  };
  console.log(JSON.stringify(summary, null, 2));

  await prisma.$disconnect();
  if (syncErrors > 0) process.exit(1);
  if (!summary.ok) {
    console.error(
      `[warn] restano Duferco non-R: UT=${utLeft} M=${mLeft}`,
    );
    process.exit(1);
  }
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
