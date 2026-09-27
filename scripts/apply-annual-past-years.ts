/**
 * CLI bonifica annuali anni passati (< 2026 → liquidate; 2026+ aperte).
 *
 * Uso:
 *   DATABASE_URL=… npx tsx scripts/apply-annual-past-years.ts --dry
 *   DATABASE_URL=… npx tsx scripts/apply-annual-past-years.ts --apply
 *
 * Neon HTTP: loop 1-by-1 (niente updateMany / $transaction).
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  ANNUAL_PAST_YEARS_CONTRACT_NOTE,
  ANNUAL_PAST_YEARS_MONTH_NOTE,
  ANNUAL_PAST_YEARS_OPEN_FROM,
  annualUnitCompetencePeriod,
  shouldLiquidateAnnualContractUnit,
  shouldLiquidateAnnualMonth,
} from "../src/lib/annual-past-years-shared";

const APPLY_FLAG = process.argv.includes("--apply");
const APPLY_IF_PROD = process.argv.includes("--apply-if-production");
const APPLY =
  APPLY_FLAG ||
  (APPLY_IF_PROD && process.env.VERCEL_ENV === "production");
const DRY = !APPLY || process.argv.includes("--dry");

if (APPLY_IF_PROD && process.env.VERCEL_ENV !== "production") {
  console.log(
    `[skip] VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"} — bonifica annuali solo in production build`,
  );
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL mancante (.env.local o env)");
  process.exit(APPLY_IF_PROD ? 0 : 1);
}

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL, {
    arrayMode: false,
    fullResults: true,
  }),
});

async function main() {
  const openFrom = ANNUAL_PAST_YEARS_OPEN_FROM;

  const months = await prisma.recurringMonth.findMany({
    where: {
      period: { lt: openFrom },
      status: { not: "LIQUIDATED" },
      contract: {
        deletedAt: null,
        isHistorical: false,
        recurrenceKind: "R",
      },
    },
    select: {
      id: true,
      period: true,
      status: true,
      amount: true,
      paidAt: true,
      settledPeriod: true,
      contractId: true,
      contract: {
        select: {
          collaborator: { select: { name: true } },
          supplier: { select: { name: true } },
          commission: { select: { id: true, paid: true, received: true } },
        },
      },
    },
    orderBy: { period: "asc" },
  });

  const toLiquidateMonths = months.filter((m) =>
    shouldLiquidateAnnualMonth({ period: m.period, status: m.status }),
  );

  const contracts = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      isHistorical: false,
      recurrenceKind: "R",
      status: {
        notIn: ["PROVVIGIONE_LIQUIDATA", "KO", "ANNULLATO", "STORNATO"],
      },
    },
    select: {
      id: true,
      status: true,
      supplyStartDate: true,
      collectionDate: true,
      insertionDate: true,
      collaborator: { select: { name: true } },
      supplier: { select: { name: true } },
      commission: {
        select: { id: true, expected: true, paid: true, received: true },
      },
    },
  });

  const toLiquidateContracts = contracts.filter((c) => {
    const unitPeriod = annualUnitCompetencePeriod(
      c.supplyStartDate,
      c.collectionDate,
      c.insertionDate,
    );
    return shouldLiquidateAnnualContractUnit({
      status: c.status,
      unitPeriod,
    });
  });

  const openKept = await prisma.recurringMonth.count({
    where: {
      period: { gte: openFrom },
      status: { in: ["PENDING", "MISSING", "PAID", "ERROR_UNPAID"] },
      contract: {
        deletedAt: null,
        isHistorical: false,
        recurrenceKind: "R",
      },
    },
  });

  const byCollab = new Map<string, number>();
  for (const m of toLiquidateMonths) {
    const name = m.contract.collaborator?.name ?? "—";
    byCollab.set(name, (byCollab.get(name) ?? 0) + 1);
  }

  console.log({
    dry: DRY,
    openFrom,
    monthsToLiquidate: toLiquidateMonths.length,
    contractsToLiquidate: toLiquidateContracts.length,
    openKept2026plus: openKept,
    byCollaborator: Object.fromEntries(
      [...byCollab.entries()].sort((a, b) => b[1] - a[1]),
    ),
    sampleMonths: toLiquidateMonths.slice(0, 8).map((m) => ({
      id: m.id,
      period: m.period,
      status: m.status,
      collab: m.contract.collaborator?.name,
      supplier: m.contract.supplier.name,
    })),
  });

  if (DRY) {
    console.log(
      "\n[DRY] Nessuna scrittura. Rilancia con --apply per liquidare.",
    );
    await prisma.$disconnect();
    return;
  }

  let monthsLiquidated = 0;
  for (const m of toLiquidateMonths) {
    await prisma.recurringMonth.update({
      where: { id: m.id },
      data: {
        status: "LIQUIDATED",
        paidAt: m.paidAt ?? new Date(),
        settledPeriod: m.settledPeriod ?? m.period,
        note: ANNUAL_PAST_YEARS_MONTH_NOTE,
      },
    });
    const commission = m.contract.commission;
    const amount = Number(m.amount ?? 0) || 0;
    if (commission && amount > 0 && m.status !== "LIQUIDATED") {
      const paid = Number(commission.paid ?? 0) || 0;
      const received = Number(commission.received ?? 0) || 0;
      await prisma.commission.update({
        where: { id: commission.id },
        data: {
          paid: paid + amount,
          received: Math.max(received, paid + amount),
        },
      });
    }
    monthsLiquidated += 1;
    if (monthsLiquidated % 50 === 0) {
      console.log(`  rate liquidate ${monthsLiquidated}/${toLiquidateMonths.length}`);
    }
  }

  let contractsLiquidated = 0;
  const admin =
    (await prisma.user.findFirst({
      where: { role: "ADMIN", active: true },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    })) ?? null;

  for (const c of toLiquidateContracts) {
    const unitPeriod = annualUnitCompetencePeriod(
      c.supplyStartDate,
      c.collectionDate,
      c.insertionDate,
    );
    const collectionDate =
      c.collectionDate ??
      c.supplyStartDate ??
      c.insertionDate ??
      (unitPeriod ? new Date(`${unitPeriod}-01T12:00:00.000Z`) : new Date());

    if (c.commission) {
      const expected = Number(c.commission.expected ?? 0) || 0;
      const paid = Number(c.commission.paid ?? 0) || 0;
      const received = Number(c.commission.received ?? 0) || 0;
      const targetReceived = Math.max(received, expected);
      const targetPaid = Math.max(paid, targetReceived);
      if (targetPaid !== paid || targetReceived !== received) {
        await prisma.commission.update({
          where: { id: c.commission.id },
          data: { paid: targetPaid, received: targetReceived },
        });
      }
    }

    await prisma.contract.update({
      where: { id: c.id },
      data: {
        status: "PROVVIGIONE_LIQUIDATA",
        paymentStatus: "Pagato",
        collectionDate,
      },
    });
    if (admin) {
      await prisma.contractStatusHistory.create({
        data: {
          contractId: c.id,
          toStatus: "PROVVIGIONE_LIQUIDATA",
          changedById: admin.id,
          note: ANNUAL_PAST_YEARS_CONTRACT_NOTE,
        },
      });
    }
    contractsLiquidated += 1;
  }

  const openKeptAfter = await prisma.recurringMonth.count({
    where: {
      period: { gte: openFrom },
      status: { in: ["PENDING", "MISSING", "PAID", "ERROR_UNPAID"] },
      contract: {
        deletedAt: null,
        isHistorical: false,
        recurrenceKind: "R",
      },
    },
  });

  const residualMonths = await prisma.recurringMonth.count({
    where: {
      period: { lt: openFrom },
      status: { not: "LIQUIDATED" },
      contract: {
        deletedAt: null,
        isHistorical: false,
        recurrenceKind: "R",
      },
    },
  });

  console.log({
    ok: true,
    monthsLiquidated,
    contractsLiquidated,
    openKeptAfter,
    residualPastMonths: residualMonths,
  });

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("[annual-past-years]", e);
  await prisma.$disconnect().catch(() => undefined);
  // In production build non far fallire il deploy: sync/cron riproveranno.
  if (APPLY_IF_PROD) {
    console.error(
      "[annual-past-years] apply fallito in build — continuo; sync/cron riproveranno",
    );
    process.exit(0);
  }
  process.exit(1);
});
