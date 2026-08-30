/**
 * Diagnostica conteggi Helios luglio 2026
 * npx tsx scripts/inspect-helios-luglio.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";

const PERIOD = "2026-07";

const recurringMonthlyWhereOr = [
  { recurrence: { equals: "M", mode: "insensitive" as const } },
  { recurrence: { equals: "Ricorrente", mode: "insensitive" as const } },
  { recurrence: { contains: "mensil", mode: "insensitive" as const } },
];

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

async function main() {
  const heliosSupplier = await prisma.supplier.findFirst({
    where: { name: { contains: "helios", mode: "insensitive" } },
    select: { id: true, name: true },
  });
  console.log("Fornitore:", heliosSupplier);

  const baseMonthly = {
    deletedAt: null,
    isHistorical: false,
    status: { notIn: ["KO", "ANNULLATO", "CHIUSO"] },
    supplier: { name: { contains: "helios", mode: "insensitive" as const } },
    OR: recurringMonthlyWhereOr,
  };

  const incassatoWhere = {
    AND: [
      baseMonthly,
      {
        OR: [
          {
            recurringMonths: { some: { period: PERIOD, status: "PAID" } },
          },
          {
            collectionDate: { not: null },
            status: { notIn: ["PROVVIGIONE_LIQUIDATA", "DA_CONTROLLARE", "STORNATO", "KO", "ANNULLATO", "CHIUSO"] },
          },
        ],
      },
      { recurringMonths: { some: { period: PERIOD, status: "PAID" } } },
    ],
  };

  const allMonthWhere = {
    AND: [
      baseMonthly,
      { recurringMonths: { some: { period: PERIOD, status: { not: "CLOSED" } } } },
    ],
  };

  const [
    totalHelios,
    heliosMonthly,
    heliosAnyRecurrence,
    monthAll,
    monthPaid,
    monthMissing,
    incassatoFiltered,
    paidRows,
    expectedRows,
  ] = await Promise.all([
    prisma.contract.count({
      where: {
        deletedAt: null,
        isHistorical: false,
        supplier: { name: { contains: "helios", mode: "insensitive" } },
      },
    }),
    prisma.contract.count({ where: baseMonthly }),
    prisma.contract.count({
      where: {
        deletedAt: null,
        isHistorical: false,
        supplier: { name: { contains: "helios", mode: "insensitive" } },
        OR: recurringMonthlyWhereOr,
      },
    }),
    prisma.contract.count({ where: allMonthWhere }),
    prisma.recurringMonth.count({
      where: {
        period: PERIOD,
        status: "PAID",
        contract: {
          deletedAt: null,
          isHistorical: false,
          supplier: { name: { contains: "helios", mode: "insensitive" } },
        },
      },
    }),
    prisma.recurringMonth.count({
      where: {
        period: PERIOD,
        status: { in: ["MISSING", "PENDING", "ERROR_UNPAID"] },
        contract: {
          deletedAt: null,
          isHistorical: false,
          supplier: { name: { contains: "helios", mode: "insensitive" } },
        },
      },
    }),
    prisma.contract.count({ where: incassatoWhere }),
    prisma.recurringMonth.findMany({
      where: {
        period: PERIOD,
        status: "PAID",
        contract: {
          deletedAt: null,
          isHistorical: false,
          supplier: { name: { contains: "helios", mode: "insensitive" } },
        },
      },
      select: { amount: true, contractId: true },
    }),
    prisma.recurringMonth.findMany({
      where: {
        period: PERIOD,
        status: { not: "CLOSED" },
        contract: {
          deletedAt: null,
          isHistorical: false,
          supplier: { name: { contains: "helios", mode: "insensitive" } },
        },
      },
      select: { status: true, contractId: true },
    }),
  ]);

  const paidAmount = paidRows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const paidContracts = new Set(paidRows.map((r) => r.contractId)).size;
  const expectedContracts = new Set(expectedRows.map((r) => r.contractId)).size;

  const recurrenceBreakdown = await prisma.contract.groupBy({
    by: ["recurrence"],
    where: {
      deletedAt: null,
      isHistorical: false,
      supplier: { name: { contains: "helios", mode: "insensitive" } },
    },
    _count: { id: true },
  });

  const notM = await prisma.contract.count({
    where: {
      deletedAt: null,
      isHistorical: false,
      supplier: { name: { contains: "helios", mode: "insensitive" } },
      NOT: { OR: recurringMonthlyWhereOr },
    },
  });

  const paidNotMonthly = await prisma.recurringMonth.count({
    where: {
      period: PERIOD,
      status: "PAID",
      contract: {
        deletedAt: null,
        isHistorical: false,
        supplier: { name: { contains: "helios", mode: "insensitive" } },
        NOT: { OR: recurringMonthlyWhereOr },
      },
    },
  });

  console.log("\n=== HELIOS LUGLIO 2026 ===");
  console.log("Contratti Helios totali:", totalHelios);
  console.log("Helios con filtro M (mensile):", heliosMonthly);
  console.log("Helios con OR recurrence mensile:", heliosAnyRecurrence);
  console.log("Helios NON classificati come M:", notM);
  console.log("Rate attese lug (non CLOSED):", expectedRows.length, "su", expectedContracts, "contratti");
  console.log("Rate PAID lug:", monthPaid, "→", paidContracts, "contratti unici,", paidAmount.toFixed(2), "€");
  console.log("Rate mancanti lug:", monthMissing);
  console.log("Filtro UI Incassato+competenza:", incassatoFiltered);
  console.log("PAID su contratti non-M:", paidNotMonthly);
  console.log("\nRecurrence breakdown:", recurrenceBreakdown);

  const baseHelios = {
    deletedAt: null,
    isHistorical: false,
    status: { notIn: ["KO", "ANNULLATO", "CHIUSO"] as const },
    supplier: { name: { equals: "Helios", mode: "insensitive" as const } },
  };
  const incassatoOr = {
    OR: [
      {
        collectionDate: { not: null },
        status: {
          notIn: ["PROVVIGIONE_LIQUIDATA", "DA_CONTROLLARE", "STORNATO", "KO", "ANNULLATO", "CHIUSO"],
        },
        supplyStartDate: { lte: new Date() },
      },
      {
        recurringMonths: { some: { status: "PAID" } },
        status: { notIn: ["PROVVIGIONE_LIQUIDATA", "STORNATO", "KO", "ANNULLATO", "CHIUSO"] },
      },
    ],
  };

  console.log("\n=== SCENARI FILTRO ===");
  for (const [label, where] of [
    ["Helios Incassato (no M, no comp)", { AND: [baseHelios, incassatoOr] }],
    ["Helios M + Incassato + comp lug", incassatoWhere],
    ["Helios M + tutte comp lug", allMonthWhere],
    ["Helios solo", baseHelios],
  ]) {
    console.log(label + ":", await prisma.contract.count({ where }));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
