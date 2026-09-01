/**
 * Corregge contratti incassati finiti per errore in CHIUSO/KO:
 * - POD sostituito da nuovo contratto → KO (resta terminale)
 * - Chiusura manuale (koReason) → invariato
 * - Tutto il resto con data incasso → Pagato (PROVVIGIONE_LIQUIDATA)
 *
 * Uso:
 *   npx tsx scripts/fix-wrong-chiuso-to-pagato.ts --dry
 *   npx tsx scripts/fix-wrong-chiuso-to-pagato.ts
 *   npx tsx scripts/fix-wrong-chiuso-to-pagato.ts --supplier sinergy
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";

const DRY = process.argv.includes("--dry");
const supplierArg = process.argv.find((a) => a.startsWith("--supplier="));
const supplierFilter = supplierArg?.split("=")[1]?.trim();

const POD_ARCHIVE = "POD ricontrattualizzato";
const TERMINAL = ["KO", "ANNULLATO", "CHIUSO"] as const;

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

function isPodSuperseded(row: {
  archiveLabel: string | null;
  koNotes: string | null;
}): boolean {
  if ((row.archiveLabel ?? "").startsWith(POD_ARCHIVE)) return true;
  const notes = row.koNotes ?? "";
  return (
    notes.includes("nuovo contratto stesso POD") ||
    notes.startsWith("Chiuso: nuovo contratto")
  );
}

async function main() {
  const rows = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      status: { in: [...TERMINAL] },
      collectionDate: { not: null },
      koReason: null,
      ...(supplierFilter
        ? {
            supplier: {
              name: { contains: supplierFilter, mode: "insensitive" as const },
            },
          }
        : {}),
    },
    select: {
      id: true,
      status: true,
      archiveLabel: true,
      koNotes: true,
      isHistorical: true,
      supplier: { select: { name: true } },
      commission: { select: { id: true, expected: true, received: true, paid: true } },
    },
    take: 8000,
  });

  let toKo = 0;
  let toPagato = 0;
  let skippedManual = 0;

  for (const row of rows) {
    if (isPodSuperseded(row)) {
      if (row.status !== "KO") {
        toKo += 1;
        if (!DRY) {
          await prisma.contract.update({
            where: { id: row.id },
            data: {
              status: "KO",
              koNotes:
                row.koNotes ??
                "KO: POD ricontrattualizzato (correzione automatica)",
            },
          });
        }
      }
      continue;
    }

    toPagato += 1;
    if (DRY) continue;

    const comm = row.commission;
    if (comm) {
      const expected = Number(comm.expected ?? 0) || 0;
      let received = Number(comm.received ?? 0) || 0;
      const paid = Number(comm.paid ?? 0) || 0;
      if (received <= 0 && expected > 0) {
        received = expected;
        await prisma.commission.update({
          where: { id: comm.id },
          data: { received },
        });
      }
      const remaining = Math.max(0, received - paid);
      if (remaining > 0) {
        await prisma.commission.update({
          where: { id: comm.id },
          data: { paid: paid + remaining },
        });
      }
    }

    await prisma.contract.update({
      where: { id: row.id },
      data: {
        status: "PROVVIGIONE_LIQUIDATA",
        isHistorical: false,
        archiveLabel:
          row.archiveLabel && !row.archiveLabel.startsWith(POD_ARCHIVE)
            ? null
            : row.archiveLabel,
      },
    });
  }

  const manual = await prisma.contract.count({
    where: {
      deletedAt: null,
      status: { in: [...TERMINAL] },
      collectionDate: { not: null },
      koReason: { not: null },
      ...(supplierFilter
        ? {
            supplier: {
              name: { contains: supplierFilter, mode: "insensitive" as const },
            },
          }
        : {}),
    },
  });
  skippedManual = manual;

  console.log({
    dry: DRY,
    supplierFilter: supplierFilter ?? "(tutti)",
    scanned: rows.length,
    toKo,
    toPagato,
    skippedManual,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
