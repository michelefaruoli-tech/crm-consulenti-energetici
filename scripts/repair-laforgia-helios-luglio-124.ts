/**
 * Allinea Laforgia Helios luglio 2026 a 124 contratti / 556€ (rendiconto Excel).
 * - Aggiunge IT001E74989230 MANCUSO SALVATORE €4 LIQUIDATED
 * - Corregge IT001E89334068 da €6 a €4
 *
 * npx tsx scripts/repair-laforgia-helios-luglio-124.ts
 * npx tsx scripts/repair-laforgia-helios-luglio-124.ts --dry
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import { normalizePodKey } from "../src/lib/storno-status";

const PERIOD = "2026-07";
const DRY = process.argv.includes("--dry");

const FIX_AMOUNT_POD = "IT001E89334068";
const ADD_POD = "IT001E74989230";

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

async function findHeliosContract(pod: string) {
  const key = normalizePodKey(pod);
  return prisma.contract.findFirst({
    where: {
      deletedAt: null,
      OR: [{ podPdr: key }, { pod: key }, { podPdr: pod }, { pod: pod }],
      supplier: { name: { contains: "helios", mode: "insensitive" } },
    },
    select: {
      id: true,
      podPdr: true,
      collaboratorId: true,
      collaborator: { select: { name: true } },
      commission: { select: { id: true, expected: true, paid: true, received: true } },
    },
  });
}

async function main() {
  const laforgia = await prisma.user.findFirst({
    where: { name: { contains: "Laforgia", mode: "insensitive" } },
  });
  if (!laforgia) throw new Error("Laforgia non trovato");

  const amountFix = await findHeliosContract(FIX_AMOUNT_POD);
  if (!amountFix) throw new Error("Contratto importo errato non trovato: " + FIX_AMOUNT_POD);

  const monthFix = await prisma.recurringMonth.findUnique({
    where: {
      contractId_period: { contractId: amountFix.id, period: PERIOD },
    },
  });
  console.log("Fix amount", FIX_AMOUNT_POD, "attuale:", monthFix?.amount, monthFix?.status);
  if (!DRY && monthFix) {
    await prisma.recurringMonth.update({
      where: { id: monthFix.id },
      data: { amount: 4 },
    });
  }

  const addContract = await findHeliosContract(ADD_POD);
  if (!addContract) throw new Error("Contratto mancante non trovato: " + ADD_POD);
  console.log(
    "Add liquidated",
    ADD_POD,
    "collab:",
    addContract.collaborator.name,
    addContract.id,
  );

  if (addContract.collaboratorId !== laforgia.id && !DRY) {
    await prisma.contract.update({
      where: { id: addContract.id },
      data: { collaboratorId: laforgia.id },
    });
  }

  const monthAdd = await prisma.recurringMonth.findUnique({
    where: {
      contractId_period: { contractId: addContract.id, period: PERIOD },
    },
  });

  if (!DRY) {
    if (monthAdd) {
      await prisma.recurringMonth.update({
        where: { id: monthAdd.id },
        data: {
          status: "LIQUIDATED",
          amount: 4,
          paidAt: monthAdd.paidAt ?? new Date(2026, 6, 1),
          settledPeriod: PERIOD,
          note: monthAdd.note ?? "Allineamento rendiconto Helios luglio 2026 Laforgia",
        },
      });
    } else {
      await prisma.recurringMonth.create({
        data: {
          contractId: addContract.id,
          period: PERIOD,
          status: "LIQUIDATED",
          amount: 4,
          paidAt: new Date(2026, 6, 1),
          settledPeriod: PERIOD,
          note: "Allineamento rendiconto Helios luglio 2026 Laforgia",
        },
      });
    }

    const commission = addContract.commission;
    if (commission) {
      const paid = Number(commission.paid ?? 0) || 0;
      await prisma.commission.update({
        where: { id: commission.id },
        data: {
          paid: paid + 4,
          received: Math.max(Number(commission.received ?? 0), paid + 4),
        },
      });
    }

    await prisma.contract.update({
      where: { id: addContract.id },
      data: {
        paymentStatus: "Pagato",
        status: "PROVVIGIONE_LIQUIDATA",
        collectionDate: new Date(2026, 6, 1),
        collaboratorId: laforgia.id,
      },
    });
  }

  const paidOnly = await prisma.recurringMonth.findMany({
    where: {
      period: PERIOD,
      status: "PAID",
      contract: {
        deletedAt: null,
        collaboratorId: laforgia.id,
        supplier: { name: { contains: "helios", mode: "insensitive" } },
      },
    },
    include: {
      contract: {
        select: {
          id: true,
          commission: { select: { id: true, paid: true, received: true } },
        },
      },
    },
  });
  if (paidOnly.length) {
    console.log("Converti PAID → LIQUIDATED:", paidOnly.length);
    if (!DRY) {
      for (const row of paidOnly) {
        const amount = Number(row.amount ?? 0) || 4;
        await prisma.recurringMonth.update({
          where: { id: row.id },
          data: {
            status: "LIQUIDATED",
            settledPeriod: PERIOD,
            note: row.note ?? "Liquidato — allineamento rendiconto luglio 2026",
          },
        });
        const commission = row.contract.commission;
        if (commission) {
          const paid = Number(commission.paid ?? 0) || 0;
          await prisma.commission.update({
            where: { id: commission.id },
            data: {
              paid: paid + amount,
              received: Math.max(Number(commission.received ?? 0), paid + amount),
            },
          });
        }
        await prisma.contract.update({
          where: { id: row.contract.id },
          data: {
            status: "PROVVIGIONE_LIQUIDATA",
            paymentStatus: "Pagato",
            collectionDate: new Date(2026, 6, 1),
          },
        });
      }
    }
  }

  const verify = await prisma.recurringMonth.findMany({
    where: {
      period: PERIOD,
      status: "LIQUIDATED",
      contract: {
        deletedAt: null,
        collaboratorId: laforgia.id,
        supplier: { name: { contains: "helios", mode: "insensitive" } },
      },
    },
    select: { amount: true },
  });
  const sum = verify.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  console.log(DRY ? "[DRY]" : "[OK]", "LIQUIDATED Laforgia Helios lug:", verify.length, "€", sum.toFixed(2));
}

main().finally(() => prisma.$disconnect());
