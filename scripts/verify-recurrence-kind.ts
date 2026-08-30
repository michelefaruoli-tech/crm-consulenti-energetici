/**
 * Confronta i conteggi ottenuti con il vecchio predicato testuale (ILIKE)
 * e con la nuova colonna indicizzata `recurrenceKind`.
 *
 * Se un solo numero diverge, il backfill non e' equivalente: NON procedere.
 *
 * Uso: npx tsx scripts/verify-recurrence-kind.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

/** Predicati testuali storici (pre-migrazione). */
const legacyAny: Prisma.ContractWhereInput[] = [
  { recurrence: { equals: "M", mode: "insensitive" } },
  { recurrence: { equals: "R", mode: "insensitive" } },
  { recurrence: { equals: "Ricorrente", mode: "insensitive" } },
  { recurrence: { contains: "ricor", mode: "insensitive" } },
  { recurrence: { contains: "mensil", mode: "insensitive" } },
  { recurrence: { contains: "annu", mode: "insensitive" } },
];

const legacyMonthly: Prisma.ContractWhereInput[] = [
  { recurrence: { equals: "M", mode: "insensitive" } },
  { recurrence: { equals: "Ricorrente", mode: "insensitive" } },
  { recurrence: { contains: "mensil", mode: "insensitive" } },
  {
    AND: [
      { recurrence: { contains: "ricor", mode: "insensitive" } },
      { NOT: { recurrence: { contains: "annu", mode: "insensitive" } } },
      { NOT: { recurrence: { equals: "R", mode: "insensitive" } } },
    ],
  },
];

const legacyAnnual: Prisma.ContractWhereInput[] = [
  { recurrence: { equals: "R", mode: "insensitive" } },
  { recurrence: { contains: "annu", mode: "insensitive" } },
  { recurrence: { contains: "12 mes", mode: "insensitive" } },
];

const legacyNonRecurring: Prisma.ContractWhereInput = {
  OR: [
    { recurrence: null },
    { recurrence: { equals: "" } },
    { NOT: { OR: legacyAny } },
  ],
};

type Check = {
  label: string;
  legacy: Prisma.ContractWhereInput;
  next: Prisma.ContractWhereInput;
};

const checks: Check[] = [
  {
    label: "Ricorrenti (M+R)",
    legacy: { OR: legacyAny },
    next: { recurrenceKind: { in: ["M", "R"] } },
  },
  {
    label: "Mensili (M)",
    legacy: { OR: legacyMonthly },
    next: { recurrenceKind: "M" },
  },
  {
    label: "Annuali (R)",
    legacy: { OR: legacyAnnual },
    next: { recurrenceKind: "R" },
  },
  {
    label: "Una tantum (UT)",
    legacy: legacyNonRecurring,
    next: { recurrenceKind: "UT" },
  },
];

/** Scope realistici: il confronto deve reggere anche combinato ad altri filtri. */
const scopes: Array<{ name: string; where: Prisma.ContractWhereInput }> = [
  { name: "tutto il DB", where: {} },
  { name: "attivi", where: { deletedAt: null, isHistorical: false } },
  {
    name: "attivi non KO",
    where: {
      deletedAt: null,
      isHistorical: false,
      status: { notIn: ["KO", "ANNULLATO", "CHIUSO"] },
    },
  },
];

async function main() {
  let failures = 0;

  for (const scope of scopes) {
    console.log(`\n=== Scope: ${scope.name} ===`);
    for (const check of checks) {
      const [legacyCount, nextCount] = await Promise.all([
        prisma.contract.count({ where: { AND: [scope.where, check.legacy] } }),
        prisma.contract.count({ where: { AND: [scope.where, check.next] } }),
      ]);
      const ok = legacyCount === nextCount;
      if (!ok) failures++;
      console.log(
        `${ok ? "✅" : "❌"} ${check.label.padEnd(20)} vecchio=${legacyCount}  nuovo=${nextCount}`,
      );
    }
  }

  // Nessun contratto deve restare fuori dalle tre categorie.
  const totals = await prisma.contract.groupBy({
    by: ["recurrenceKind"],
    _count: { _all: true },
  });
  console.log("\n=== Distribuzione recurrenceKind ===");
  console.table(
    totals.map((t) => ({ kind: t.recurrenceKind, count: t._count._all })),
  );

  await prisma.$disconnect();

  if (failures > 0) {
    console.error(`\n❌ ${failures} divergenze: NON sostituire i predicati.`);
    process.exit(1);
  }
  console.log("\n✅ Backfill equivalente: sostituzione predicati sicura.");
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
