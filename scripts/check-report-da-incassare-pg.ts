/**
 * Integrazione: 60 € UT + 4 € rata Helios Da incassare → Report e Provvigioni 64 €.
 * Richiede DATABASE_URL postgres:// e schema (`prisma db push`).
 *
 * Uso: DATABASE_URL=postgresql://... npx tsx scripts/check-report-da-incassare-pg.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildRendiconto } from "../src/lib/report-rendiconto";
import { reportIncassatoAmount } from "../src/lib/report-rendiconto";
import {
  compareReportProvvigioniDaIncassare,
  sumDaIncassareLikeProvvigioni,
} from "../src/lib/report-provvigioni-totals";
import { loadReportRecurringPaid } from "../src/lib/report-recurring";
import { buildReportContractWhere } from "../src/lib/report-filters";

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
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });

  const am = await prisma.user.upsert({
    where: { email: "am-blasucci-test@example.com" },
    create: {
      email: "am-blasucci-test@example.com",
      name: "Blasucci",
      password: "x",
      role: "AREA_MANAGER",
    },
    update: {},
  });
  const genzano = await prisma.user.upsert({
    where: { email: "genzano-test@example.com" },
    create: {
      email: "genzano-test@example.com",
      name: "Genzano L.",
      password: "x",
      role: "COLLABORATORE",
    },
    update: {},
  });
  await prisma.userCollaboratorScope.upsert({
    where: {
      userId_collaboratorId: { userId: am.id, collaboratorId: genzano.id },
    },
    create: { userId: am.id, collaboratorId: genzano.id },
    update: {},
  });

  const helios = await prisma.supplier.upsert({
    where: { code: "HELIOS_TEST_RPT" },
    create: {
      name: "Helios",
      code: "HELIOS_TEST_RPT",
      stornoMonths: 12,
    },
    update: {},
  });
  const enel = await prisma.supplier.upsert({
    where: { code: "ENEL_TEST_RPT" },
    create: { name: "Enel", code: "ENEL_TEST_RPT", stornoMonths: 12 },
    update: {},
  });

  const client = await prisma.client.create({
    data: {
      type: "PRIVATO",
      firstName: "Donato",
      lastName: "Malatesta",
      fiscalCode: `MLT${Date.now()}`,
      createdById: am.id,
    },
  });

  const suffix = Date.now();
  const utContract = await prisma.contract.create({
    data: {
      contractNumber: `RPT-UT-${suffix}`,
      clientId: client.id,
      supplierId: enel.id,
      collaboratorId: genzano.id,
      recurrence: "Una tantum",
      recurrenceKind: "UT",
      status: "IN_ATTESA_PAGAMENTO",
      paymentStatus: "Da incassare",
      insertionDate: new Date(2026, 5, 10),
      podPdr: "IT001E000099",
      commission: { create: { expected: 60 } },
    },
    include: { commission: true, supplier: true, client: true },
  });

  const mContract = await prisma.contract.create({
    data: {
      contractNumber: `RPT-M-${suffix}`,
      clientId: client.id,
      supplierId: helios.id,
      collaboratorId: genzano.id,
      recurrence: "Mensile",
      recurrenceKind: "M",
      status: "ATTIVATO",
      paymentStatus: "Da incassare",
      insertionDate: new Date(2026, 3, 1),
      supplyStartDate: new Date(2026, 3, 1),
      podPdr: "IT001E89300588",
      commission: { create: { expected: 4 } },
      recurringMonths: {
        create: {
          period: "2026-07",
          status: "PENDING",
          amount: 4,
        },
      },
    },
    include: { commission: true, supplier: true, client: true },
  });

  const visibility = {
    collaboratorId: { in: [am.id, genzano.id] },
  };

  const provTotal = await sumDaIncassareLikeProvvigioni({
    sessionUserId: am.id,
    canViewAll: true,
    visibility,
    collaboratorId: genzano.id,
  });

  const contractWhere = buildReportContractWhere(
    {
      month: "2026-09",
      from: "2026-09-01",
      to: "2026-09-30",
      collaboratorId: genzano.id,
      stato: "Da incassare",
    },
    visibility,
  );
  const contracts = await prisma.contract.findMany({
    where: contractWhere,
    include: { commission: true, supplier: true, client: true, collaborator: true },
  });
  const recurringRows = await loadReportRecurringPaid({
    month: "2026-09",
    from: "2026-09-01",
    to: "2026-09-30",
    collaboratorId: genzano.id,
    visibility,
    competenceOnly: true,
    stato: "Da incassare",
    now: new Date(2026, 8, 26),
  });

  const oneShot = contracts.filter((c) => c.recurrenceKind !== "M");
  const oneShotSum = oneShot.reduce(
    (s, c) =>
      s +
      reportIncassatoAmount(c.commission, {
        clientType: c.client.type,
        supplierName: c.supplier.name,
      }),
    0,
  );
  const recurringSum = recurringRows.reduce((s, r) => s + r.amount, 0);
  const reportTotal = oneShotSum + recurringSum;

  const rendiconto = buildRendiconto({
    contracts: contracts.map((c) => ({
      contractNumber: c.contractNumber,
      collectionDate: c.collectionDate,
      insertionDate: c.insertionDate,
      status: c.status,
      podPdr: c.podPdr,
      pod: c.pod,
      pdr: c.pdr,
      collaborator: { name: c.collaborator.name },
      supplier: { name: c.supplier.name },
      client: c.client,
      commission: c.commission,
      recurrence: c.recurrence,
    })),
    stornoRows: [],
    recurringRows,
    incassatoMonths: ["2026-09"],
    inlineRecurring: true,
  });

  const alignment = compareReportProvvigioniDaIncassare(reportTotal, provTotal);
  console.log("Provvigioni Da incassare:", provTotal);
  console.log("Report (oneShot + rate):", reportTotal, "rendiconto:", rendiconto.totIncassato);
  console.log("Contratti:", contracts.length, "rate:", recurringRows.length);

  if (!alignment.ok || provTotal !== 64 || reportTotal !== 64) {
    console.error("❌ Totali non allineati:", alignment);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log("✅ Postgres: Report e Provvigioni entrambi 64 €.");

  await prisma.contract.deleteMany({
    where: { id: { in: [utContract.id, mContract.id] } },
  });
  await prisma.client.delete({ where: { id: client.id } });
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
