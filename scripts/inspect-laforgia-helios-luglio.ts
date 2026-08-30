/**
 * Dettaglio Helios luglio Laforgia vs atteso 544€ / ~136 contratti
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
  const michele = await prisma.user.findFirst({
    where: {
      OR: [
        { name: { contains: "Michele", mode: "insensitive" } },
        { email: { contains: "michele", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true },
  });
  if (!laforgia) throw new Error("Laforgia missing");

  const heliosBase = {
    deletedAt: null,
    isHistorical: false,
    supplier: { name: { contains: "helios", mode: "insensitive" as const } },
    OR: recurringMonthlyWhereOr,
    status: { notIn: ["KO", "ANNULLATO", "CHIUSO"] as const },
  };

  for (const [label, collabId] of [
    ["Laforgia", laforgia.id],
    ["Michele", michele?.id ?? "none"],
  ] as const) {
    if (collabId === "none") continue;
    const rows = await prisma.recurringMonth.findMany({
      where: {
        period: PERIOD,
        status: { in: ["PAID", "LIQUIDATED"] },
        contract: { ...heliosBase, collaboratorId: collabId },
      },
      select: { status: true, amount: true },
    });
    const sum = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
    const liq = rows.filter((r) => r.status === "LIQUIDATED");
    const paid = rows.filter((r) => r.status === "PAID");
    console.log(`\nHelios lug ${label}: ${rows.length} rate (PAID ${paid.length}, LIQ ${liq.length}) €${sum.toFixed(2)}`);
  }

  const missingLaf = await prisma.recurringMonth.findMany({
    where: {
      period: PERIOD,
      status: { in: ["MISSING", "PENDING", "ERROR_UNPAID"] },
      contract: { ...heliosBase, collaboratorId: laforgia.id },
    },
    select: {
      amount: true,
      contract: { select: { podPdr: true } },
    },
  });
  console.log("\nHelios lug Laforgia MANCANTI:", missingLaf.length, "€", missingLaf.reduce((s,r)=>s+Number(r.amount??0),0));

  const noJulyRate = await prisma.contract.findMany({
    where: {
      ...heliosBase,
      collaboratorId: laforgia.id,
      NOT: {
        recurringMonths: { some: { period: PERIOD, status: { not: "CLOSED" } } },
      },
    },
    select: { podPdr: true, supplyStartDate: true, paymentStatus: true, status: true },
    take: 30,
  });
  console.log("Laforgia Helios M senza rata lug:", noJulyRate.length);
  if (noJulyRate.length) console.log(JSON.stringify(noJulyRate.slice(0, 5), null, 2));

  // UI Pagato filter exact
  const pagatoList = await prisma.contract.findMany({
    where: {
      AND: [
        { ...heliosBase, collaboratorId: laforgia.id },
        { recurringMonths: { some: { period: PERIOD, status: "LIQUIDATED" } } },
      ],
    },
    select: {
      recurringMonths: { where: { period: PERIOD }, select: { status: true, amount: true } },
    },
  });
  const pagatoSum = pagatoList.reduce((s, c) => {
    const m = c.recurringMonths.find((r) => r.status === "LIQUIDATED");
    return s + Number(m?.amount ?? 0);
  }, 0);
  console.log("\nUI Pagato Helios Laforgia lug:", pagatoList.length, "€", pagatoSum.toFixed(2));

  // PAID+LIQUIDATED together (incassato OR pagato)
  const allPaidTypes = await prisma.recurringMonth.findMany({
    where: {
      period: PERIOD,
      status: { in: ["PAID", "LIQUIDATED"] },
      contract: { ...heliosBase, collaboratorId: laforgia.id },
    },
    select: { amount: true, status: true },
  });
  console.log("PAID+LIQUIDATED Helios Laforgia:", allPaidTypes.length, "€", allPaidTypes.reduce((s,r)=>s+Number(r.amount??0),0).toFixed(2));

  // Wrong amounts on 4€ contracts
  const liq = await prisma.recurringMonth.findMany({
    where: {
      period: PERIOD,
      status: "LIQUIDATED",
      contract: { ...heliosBase, collaboratorId: laforgia.id },
    },
    select: { amount: true, contract: { select: { podPdr: true } } },
  });
  const not4or6 = liq.filter((r) => {
    const a = Number(r.amount ?? 0);
    return a !== 4 && a !== 6;
  });
  console.log("\nLIQUIDATED importo != 4/6:", not4or6.length, not4or6.map(r => `${r.contract.podPdr}=${r.amount}`).join(", "));
}

main().finally(() => prisma.$disconnect());
