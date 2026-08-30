import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";

const PERIOD = "2026-07";
const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

async function main() {
  const laforgia = await prisma.user.findFirst({
    where: { name: { contains: "Laforgia", mode: "insensitive" } },
  });
  if (!laforgia) throw new Error("no laforgia");

  const where = {
    deletedAt: null,
    isHistorical: false,
    collaboratorId: laforgia.id,
    status: { notIn: ["KO", "ANNULLATO", "CHIUSO"] as const },
    OR: [
      { recurrence: { equals: "M", mode: "insensitive" as const } },
      { recurrence: { equals: "Ricorrente", mode: "insensitive" as const } },
      { recurrence: { contains: "mensil", mode: "insensitive" as const } },
    ],
    recurringMonths: { some: { period: PERIOD, status: "LIQUIDATED" as const } },
  };

  const contracts = await prisma.contract.findMany({
    where,
    select: {
      commission: { select: { expected: true } },
      recurringMonths: {
        where: { period: PERIOD },
        select: { status: true, amount: true },
      },
    },
  });

  const expSum = contracts.reduce(
    (s, c) => s + Number(c.commission?.expected ?? 0),
    0,
  );
  const monthSum = contracts.reduce((s, c) => {
    const m = c.recurringMonths.find((r) => r.status === "LIQUIDATED");
    return s + Number(m?.amount ?? 0);
  }, 0);

  console.log("Contratti Pagato M Laforgia lug:", contracts.length);
  console.log("Somma commission.expected:", expSum.toFixed(2));
  console.log("Somma recurringMonth LIQUIDATED:", monthSum.toFixed(2));
}

main().finally(() => prisma.$disconnect());
