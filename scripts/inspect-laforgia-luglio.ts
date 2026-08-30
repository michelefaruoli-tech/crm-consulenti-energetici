/**
 * Diagnostica Laforgia luglio 2026 ricorrenti pagati/incassati
 * npx tsx scripts/inspect-laforgia-luglio.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

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
  const laforgia = await prisma.user.findFirst({
    where: { name: { contains: "Laforgia", mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!laforgia) throw new Error("Laforgia non trovato");
  console.log("Collaboratore:", laforgia);

  const baseContract = {
    deletedAt: null,
    isHistorical: false,
    collaboratorId: laforgia.id,
    status: { notIn: ["KO", "ANNULLATO", "CHIUSO"] as const },
    OR: recurringMonthlyWhereOr,
  };

  const paidMonths = await prisma.recurringMonth.findMany({
    where: {
      period: PERIOD,
      status: { in: ["PAID", "LIQUIDATED"] },
      contract: baseContract,
    },
    select: {
      id: true,
      status: true,
      amount: true,
      period: true,
      contractId: true,
      contract: {
        select: {
          podPdr: true,
          recurrence: true,
          paymentStatus: true,
          status: true,
          collectionDate: true,
          supplyStartDate: true,
          supplier: { select: { name: true } },
          client: {
            select: { firstName: true, lastName: true, companyName: true },
          },
        },
      },
    },
    orderBy: { amount: "desc" },
  });

  const onlyPaid = paidMonths.filter((r) => r.status === "PAID");
  const onlyLiq = paidMonths.filter((r) => r.status === "LIQUIDATED");

  const sum = (rows: typeof paidMonths) =>
    rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);

  console.log("\n=== RATE LUG 2026 PAID/LIQUIDATED (M) ===");
  console.log("PAID:", onlyPaid.length, "€", sum(onlyPaid).toFixed(2));
  console.log("LIQUIDATED:", onlyLiq.length, "€", sum(onlyLiq).toFixed(2));
  console.log("Totale:", paidMonths.length, "€", sum(paidMonths).toFixed(2));
  console.log("Contratti unici:", new Set(paidMonths.map((r) => r.contractId)).size);

  const missing = await prisma.recurringMonth.findMany({
    where: {
      period: PERIOD,
      status: { in: ["MISSING", "PENDING", "ERROR_UNPAID"] },
      contract: baseContract,
    },
    select: { amount: true, contractId: true, status: true },
  });
  console.log("\nMancanti lug:", missing.length, "€", sum(missing as typeof paidMonths).toFixed(2));

  const incassatoContracts = await prisma.contract.count({
    where: {
      AND: [
        baseContract,
        {
          recurringMonths: { some: { period: PERIOD, status: "PAID" } },
        },
      ],
    },
  });
  console.log("Contratti con rata PAID lug (filtro UI):", incassatoContracts);

  const pagatoContracts = await prisma.contract.count({
    where: {
      AND: [
        baseContract,
        {
          OR: [
            { recurringMonths: { some: { period: PERIOD, status: "LIQUIDATED" } } },
            { status: "PROVVIGIONE_LIQUIDATA" },
          ],
        },
      ],
    },
  });
  console.log("Contratti liquidati / pagati:", pagatoContracts);

  const bySupplier = new Map<string, { count: number; amount: number }>();
  for (const r of onlyPaid) {
    const s = r.contract.supplier?.name ?? "?";
    const cur = bySupplier.get(s) ?? { count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += Number(r.amount ?? 0);
    bySupplier.set(s, cur);
  }
  console.log("\n=== PAID per fornitore ===");
  for (const [s, v] of [...bySupplier.entries()].sort((a, b) => b[1].amount - a[1].amount)) {
    console.log(`  ${s}: ${v.count} rate, €${v.amount.toFixed(2)}`);
  }

  const zeroAmount = onlyPaid.filter((r) => !Number(r.amount ?? 0));
  if (zeroAmount.length) {
    console.log("\nPAID con importo 0/null:", zeroAmount.length);
  }

  const noRateButIncassato = await prisma.contract.findMany({
    where: {
      AND: [
        baseContract,
        {
          paymentStatus: "Incassato",
          NOT: {
            recurringMonths: { some: { period: PERIOD, status: { in: ["PAID", "LIQUIDATED"] } } },
          },
        },
      ],
    },
    select: {
      id: true,
      podPdr: true,
      supplier: { select: { name: true } },
      commission: { select: { expected: true, received: true } },
    },
    take: 20,
  });
  if (noRateButIncassato.length) {
    console.log("\nIncassati senza rata PAID lug:", noRateButIncassato.length);
    console.log(JSON.stringify(noRateButIncassato.slice(0, 5), null, 2));
  }

  const paidWrongCollab = await prisma.recurringMonth.findMany({
    where: {
      period: PERIOD,
      status: "PAID",
      contract: {
        deletedAt: null,
        isHistorical: false,
        NOT: { collaboratorId: laforgia.id },
        OR: recurringMonthlyWhereOr,
        supplier: { name: { contains: "helios", mode: "insensitive" } },
      },
    },
    select: {
      amount: true,
      contract: {
        select: {
          podPdr: true,
          collaborator: { select: { name: true } },
        },
      },
    },
  });
  const wrongSum = paidWrongCollab.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  console.log("\nHelios PAID lug NON Laforgia:", paidWrongCollab.length, "€", wrongSum.toFixed(2));

  const expected544Gap = 544 - sum(onlyPaid);
  console.log("\nGap vs 544€ attesi (solo PAID):", expected544Gap.toFixed(2), "€");

  // --- Simula filtri UI ---
  const uiPagatoWhere = {
    AND: [
      baseContract,
      {
        OR: [
          {
            status: { equals: "PROVVIGIONE_LIQUIDATA" as const },
            supplyStartDate: { lte: new Date() },
          },
          {
            recurringMonths: {
              some: { status: "LIQUIDATED" as const, period: PERIOD },
            },
          },
        ],
      },
    ],
  };

  const uiIncassatoWhere = {
    AND: [
      baseContract,
      {
        OR: [
          {
            collectionDate: { not: null },
            status: {
              notIn: [
                "PROVVIGIONE_LIQUIDATA",
                "DA_CONTROLLARE",
                "STORNATO",
                "KO",
                "ANNULLATO",
                "CHIUSO",
              ] as const,
            },
            supplyStartDate: { lte: new Date() },
          },
          {
            recurringMonths: { some: { status: "PAID" as const, period: PERIOD } },
            status: {
              notIn: [
                "PROVVIGIONE_LIQUIDATA",
                "STORNATO",
                "KO",
                "ANNULLATO",
                "CHIUSO",
              ] as const,
            },
          },
        ],
      },
    ],
  };

  const pagatoContractsUi = await prisma.contract.findMany({
    where: uiPagatoWhere,
    select: {
      id: true,
      podPdr: true,
      recurrence: true,
      status: true,
      recurringMonths: {
        where: { period: PERIOD },
        select: { status: true, amount: true },
      },
      commission: { select: { expected: true } },
      supplier: { select: { name: true } },
    },
  });

  let pagatoAmount = 0;
  for (const c of pagatoContractsUi) {
    const rm = c.recurringMonths.find((m) => m.status === "LIQUIDATED");
    const amt = rm
      ? Number(rm.amount ?? 0)
      : Number(c.commission?.expected ?? 0);
    pagatoAmount += amt;
  }

  console.log("\n=== FILTRO UI Pagato + M + lug ===");
  console.log("Contratti:", pagatoContractsUi.length, "€", pagatoAmount.toFixed(2));

  const liqRows = await prisma.recurringMonth.findMany({
    where: {
      period: PERIOD,
      status: "LIQUIDATED",
      contract: baseContract,
    },
    select: { amount: true, contractId: true, contract: { select: { supplier: { select: { name: true } } } } },
  });
  console.log("LIQUIDATED lug (tutti M Laforgia):", liqRows.length, "€", sum(liqRows as typeof paidMonths).toFixed(2));
  console.log("Gap vs 544€ (LIQUIDATED):", (544 - sum(liqRows as typeof paidMonths)).toFixed(2));

  const wrongAmounts = liqRows.filter((r) => {
    const a = Number(r.amount ?? 0);
    return a !== 4 && a !== 6 && a !== 0;
  });
  const amountBreakdown = new Map<number, number>();
  for (const r of liqRows) {
    const a = Number(r.amount ?? 0);
    amountBreakdown.set(a, (amountBreakdown.get(a) ?? 0) + 1);
  }
  console.log("\nDistribuzione importi LIQUIDATED:", [...amountBreakdown.entries()].sort((a,b)=>b[1]-a[1]));

  const heliosLiq = liqRows.filter((r) => /helios/i.test(r.contract.supplier?.name ?? ""));
  console.log("Helios LIQUIDATED lug:", heliosLiq.length, "€", sum(heliosLiq as typeof paidMonths).toFixed(2));

  const heliosPaidNotLiq = await prisma.recurringMonth.findMany({
    where: {
      period: PERIOD,
      status: "PAID",
      contract: {
        ...baseContract,
        supplier: { name: { contains: "helios", mode: "insensitive" } },
      },
    },
    select: { amount: true, contractId: true },
  });
  console.log("Helios PAID (non liquidato) lug Laforgia:", heliosPaidNotLiq.length, "€", sum(heliosPaidNotLiq as typeof paidMonths).toFixed(2));

  if (heliosPaidNotLiq.length) {
    console.log("→ Se Incassato UI conta solo PAID, mancano questi contratti nel totale incassato");
  }
}

main().finally(() => prisma.$disconnect());
