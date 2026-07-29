/**
 * Rimuove etichette «(unito in Enel/Edison)» dai fornitori archivio.
 * Uso: npx tsx scripts/cleanup-merged-supplier-labels.ts
 */
import "dotenv/config";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  canonicalSupplierName,
  stripMergedSupplierLabel,
} from "../src/lib/supplier-merge";

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

async function main() {
  const all = await prisma.supplier.findMany({
    select: { id: true, name: true, code: true, active: true },
  });

  let renamed = 0;
  for (const s of all) {
    const hasUnito = /\(unito in/i.test(s.name);
    const isMergedCode = /_MERGED_/i.test(s.code);
    if (!hasUnito && !isMergedCode) continue;

    const base = stripMergedSupplierLabel(s.name);
    const canon = canonicalSupplierName(base);
    const newName = `_archivio_${canon.toLowerCase()}_${s.id.slice(-6)}`;
    const newCode = isMergedCode
      ? s.code
      : `${s.code}_MERGED_${Date.now()}`.slice(0, 60);

    console.log("RENAME", s.name, "→", newName, "| active=false");
    await prisma.supplier.update({
      where: { id: s.id },
      data: {
        name: newName,
        code: newCode,
        active: false,
      },
    });
    renamed += 1;
  }

  // Assicura che i canonici attivi si chiamino Enel / Edison
  for (const name of ["Enel", "Edison"] as const) {
    const actives = await prisma.supplier.findMany({
      where: {
        active: true,
        NOT: { name: { startsWith: "_archivio_" } },
      },
      select: { id: true, name: true, _count: { select: { contracts: true } } },
    });
    const group = actives.filter((s) => canonicalSupplierName(s.name) === name);
    if (group.length === 0) continue;
    group.sort((a, b) => b._count.contracts - a._count.contracts);
    const keep = group[0]!;
    if (keep.name !== name) {
      console.log("CANON", keep.name, "→", name);
      await prisma.supplier.update({
        where: { id: keep.id },
        data: { name },
      });
    }
    for (const other of group.slice(1)) {
      console.log("DEACTIVATE duplicate active", other.name);
      await prisma.supplier.update({
        where: { id: other.id },
        data: {
          active: false,
          name: `_archivio_${name.toLowerCase()}_${other.id.slice(-6)}`,
          code: `${other.id}_MERGED_${Date.now()}`.slice(0, 60),
        },
      });
    }
  }

  console.log("Renamed:", renamed);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
