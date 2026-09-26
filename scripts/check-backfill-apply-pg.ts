/**
 * Integrazione backfill su Postgres effimero (stesso piano anteprima → applica).
 * Richiede DATABASE_URL postgres:// e schema migrato (`prisma db push`).
 *
 * Uso: DATABASE_URL=postgresql://... npx tsx scripts/check-backfill-apply-pg.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.log("DATABASE_URL mancante — salto test integrazione Postgres.");
    return;
  }
  if (!url.startsWith("postgresql://") && !url.startsWith("postgres://")) {
    console.log("Connection string non Postgres — salto test integrazione.");
    return;
  }

  process.env.PRISMA_PG_DIRECT = "1";
  const { applyMissingProvvigioniRows, findMissing, planBackfillForContract } =
    await import("../src/lib/recurring-backfill");

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
  const now = new Date(2026, 8, 15);

  const supplier = await prisma.supplier.upsert({
    where: { code: "SINERGY_TEST" },
    create: { name: "Sinergy", code: "SINERGY_TEST", stornoMonths: 12 },
    update: {},
  });
  const collab = await prisma.user.upsert({
    where: { email: "backfill-test@example.com" },
    create: {
      email: "backfill-test@example.com",
      name: "Test Collab",
      password: "x",
      role: "ADMIN",
    },
    update: {},
  });
  const client = await prisma.client.create({
    data: {
      type: "PRIVATO",
      firstName: "Andrea",
      lastName: "Pagavino",
      fiscalCode: `PGV${Date.now()}`,
      createdById: collab.id,
    },
  });

  const contract = await prisma.contract.create({
    data: {
      contractNumber: `TEST-BF-${Date.now()}`,
      clientId: client.id,
      supplierId: supplier.id,
      collaboratorId: collab.id,
      recurrence: "R",
      recurrenceKind: "R",
      status: "ATTIVATO",
      insertionDate: new Date(2025, 6, 1),
      supplyStartDate: new Date(2025, 6, 1),
      collectionDate: new Date(2025, 6, 20),
      podPdr: "IT001E32491214",
      commission: { create: { expected: 120 } },
      recurringMonths: {
        create: {
          period: "2025-07",
          status: "PAID",
          amount: 120,
          paidAt: new Date(2025, 6, 25),
        },
      },
    },
    select: {
      id: true,
      podPdr: true,
      pod: true,
      pdr: true,
      recurrence: true,
      recurrenceKind: true,
      collectionDate: true,
      insertionDate: true,
      supplyStartDate: true,
      operationType: true,
      status: true,
      expiryDate: true,
      supplier: { select: { name: true } },
      collaborator: { select: { name: true } },
      client: {
        select: { type: true, companyName: true, firstName: true, lastName: true },
      },
      statusHistory: {
        where: { toStatus: "CHIUSO" },
        select: { changedAt: true },
        orderBy: { changedAt: "desc" },
        take: 1,
      },
      recurringMonths: { select: { period: true, status: true, note: true } },
      commission: { select: { expected: true } },
    },
  });

  const loaded = contract as Parameters<typeof findMissing>[0];
  const preview = findMissing(loaded, now);
  const plan = planBackfillForContract(loaded, now);
  if (!preview || preview.missingPeriods[0] !== "2026-07") {
    throw new Error(`KO anteprima: ${JSON.stringify(preview)}`);
  }
  if (plan.length !== 1 || plan[0]?.period !== "2026-07") {
    throw new Error(`KO piano: ${JSON.stringify(plan)}`);
  }

  const before = await prisma.recurringMonth.count({ where: { contractId: contract.id } });
  const apply = await applyMissingProvvigioniRows([contract.id]);
  const after = await prisma.recurringMonth.count({ where: { contractId: contract.id } });

  if (apply.created < 1 || after <= before) {
    throw new Error(`KO apply (vecchio sync=0): ${JSON.stringify(apply)}`);
  }
  const lug = await prisma.recurringMonth.findFirst({
    where: { contractId: contract.id, period: "2026-07" },
  });
  if (!lug || (lug.status !== "MISSING" && lug.status !== "PENDING")) {
    throw new Error(`KO rata lug 2026: ${JSON.stringify(lug)}`);
  }

  console.log("✅ Backfill apply Postgres: creata rata annuale 2026-07 come da piano.");
  await prisma.contract.delete({ where: { id: contract.id } });
  await prisma.client.delete({ where: { id: client.id } });
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
