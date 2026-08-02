/**
 * Allinea ricorrenze fornitore:
 * - Helios (tutti) → M (mensile)
 * - Sorgenia Business (AZIENDA) → M
 * - Etruria (tutti) → R (annuale 12 mesi)
 * - Sinergy (tutti) → R
 * - Legacy «Ricorrente» → M
 *
 * Uso:
 *   npx tsx scripts/set-recurrence-by-supplier.ts --dry
 *   npx tsx scripts/set-recurrence-by-supplier.ts
 */
import "dotenv/config";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";

const DRY = process.argv.includes("--dry");

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

async function setRecurrence(ids: string[], recurrence: string) {
  for (const id of ids) {
    await prisma.contract.update({
      where: { id },
      data: { recurrence },
    });
  }
}

async function main() {
  const helios = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      isHistorical: false,
      supplier: { name: { equals: "Helios", mode: "insensitive" } },
      NOT: { recurrence: { equals: "M" } },
    },
    select: { id: true },
  });

  const sorgeniaBus = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      isHistorical: false,
      supplier: { name: { equals: "Sorgenia", mode: "insensitive" } },
      client: { type: "AZIENDA" },
      NOT: { recurrence: { equals: "M" } },
    },
    select: { id: true },
  });

  const etruria = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      isHistorical: false,
      supplier: { name: { equals: "Etruria", mode: "insensitive" } },
      NOT: { recurrence: { equals: "R" } },
    },
    select: { id: true },
  });

  const sinergy = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      isHistorical: false,
      supplier: { name: { equals: "Sinergy", mode: "insensitive" } },
      NOT: { recurrence: { equals: "R" } },
    },
    select: { id: true },
  });

  console.log({
    dry: DRY,
    heliosToM: helios.length,
    sorgeniaBusToM: sorgeniaBus.length,
    etruriaToR: etruria.length,
    sinergyToR: sinergy.length,
  });

  if (DRY) {
    await prisma.$disconnect();
    return;
  }

  await setRecurrence(
    helios.map((c) => c.id),
    "M",
  );
  await setRecurrence(
    sorgeniaBus.map((c) => c.id),
    "M",
  );
  await setRecurrence(
    etruria.map((c) => c.id),
    "R",
  );
  await setRecurrence(
    sinergy.map((c) => c.id),
    "R",
  );

  const legacy = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      isHistorical: false,
      recurrence: { equals: "Ricorrente", mode: "insensitive" },
    },
    select: { id: true },
  });
  console.log({ legacyRicorrenteToM: legacy.length });
  await setRecurrence(
    legacy.map((c) => c.id),
    "M",
  );

  console.log("OK");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
