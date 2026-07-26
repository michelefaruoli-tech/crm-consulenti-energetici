/**
 * One-shot: riattiva contratti importati nascosti + archivia POD ricontrattualizzati.
 *   npx tsx scripts/reactivate-provvigioni.ts
 */
import "dotenv/config";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  computeStornoEndDate,
  normalizePodKey,
} from "../src/lib/storno-status";

neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString || connectionString.includes("user:password@host")) {
  throw new Error("DATABASE_URL non configurata");
}

const adapter = new PrismaNeon({ connectionString });
const prisma = new PrismaClient({ adapter });

const POD_ARCHIVE_LABEL = "POD ricontrattualizzato";

async function main() {
  const beforeActive = await prisma.contract.count({
    where: { deletedAt: null, isHistorical: false },
  });
  const beforeHist = await prisma.contract.count({
    where: { deletedAt: null, isHistorical: true },
  });

  const reactivated = await prisma.contract.updateMany({
    where: {
      deletedAt: null,
      isHistorical: true,
      OR: [
        { archiveLabel: null },
        { NOT: { archiveLabel: { startsWith: POD_ARCHIVE_LABEL } } },
      ],
    },
    data: { isHistorical: false },
  });

  // Archive superseded POD (same logic as lib)
  const contracts = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      isHistorical: false,
      OR: [{ podPdr: { not: null } }, { pod: { not: null } }, { pdr: { not: null } }],
    },
    select: {
      id: true,
      status: true,
      podPdr: true,
      pod: true,
      pdr: true,
      supplyStartDate: true,
      insertionDate: true,
      createdAt: true,
      collectionDate: true,
      stornoEndDate: true,
      supplier: { select: { stornoMonths: true } },
    },
    take: 12000,
  });

  type Row = (typeof contracts)[number] & { podKey: string; score: number };
  const scored: Row[] = [];
  for (const c of contracts) {
    const podKey = normalizePodKey(c.podPdr || c.pod || c.pdr);
    if (!podKey || podKey.length < 6) continue;
    const supply = c.supplyStartDate?.getTime() ?? 0;
    const insert = c.insertionDate?.getTime() ?? 0;
    const created = c.createdAt.getTime();
    scored.push({
      ...c,
      podKey,
      score: supply * 1e6 + insert * 1e3 + created,
    });
  }

  const byPod = new Map<string, Row[]>();
  for (const s of scored) {
    const list = byPod.get(s.podKey) ?? [];
    list.push(s);
    byPod.set(s.podKey, list);
  }

  const toArchive: string[] = [];
  const now = new Date();
  for (const [, list] of byPod) {
    if (list.length < 2) continue;
    list.sort((a, b) => b.score - a.score);
    for (const older of list.slice(1)) {
      if (["KO", "ANNULLATO", "CHIUSO"].includes(older.status)) {
        toArchive.push(older.id);
        continue;
      }
      const stornoEnd = computeStornoEndDate(
        older.supplyStartDate,
        older.supplier.stornoMonths,
        older.stornoEndDate,
      );
      if (
        older.collectionDate &&
        stornoEnd &&
        stornoEnd.getTime() >= now.getTime()
      ) {
        continue;
      }
      toArchive.push(older.id);
    }
  }

  let archived = 0;
  for (let i = 0; i < toArchive.length; i += 100) {
    const chunk = toArchive.slice(i, i + 100);
    const res = await prisma.contract.updateMany({
      where: { id: { in: chunk }, isHistorical: false },
      data: { isHistorical: true, archiveLabel: POD_ARCHIVE_LABEL },
    });
    archived += res.count;
  }

  const afterActive = await prisma.contract.count({
    where: { deletedAt: null, isHistorical: false },
  });
  const afterHist = await prisma.contract.count({
    where: { deletedAt: null, isHistorical: true },
  });

  // Spot-check collaborators
  const names = ["Lobefaro", "Mecca", "Erika", "Doto"];
  const users = await prisma.user.findMany({
    where: { OR: names.map((n) => ({ name: { contains: n, mode: "insensitive" } })) },
    select: { id: true, name: true },
  });
  console.log("BEFORE active/hist:", beforeActive, beforeHist);
  console.log("Reactivated:", reactivated.count);
  console.log("Archived POD superseded:", archived);
  console.log("AFTER active/hist:", afterActive, afterHist);
  for (const u of users) {
    const active = await prisma.contract.count({
      where: { collaboratorId: u.id, deletedAt: null, isHistorical: false },
    });
    console.log(`  ${u.name}: attivi=${active}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
