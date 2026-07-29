/**
 * Allinea Helios giugno Laforgia (postaservicemelfi) a 100/€454
 * usando Foglio2 del rendiconto (colonna collaboratore).
 *
 * Uso: npx tsx scripts/fix-helios-giugno-laforgia-100.ts
 */
import "dotenv/config";
import fs from "fs";
import ExcelJS from "exceljs";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import { normalizePodKey } from "../src/lib/storno-status";
import { clientDisplayName } from "../src/lib/utils";
import {
  isRecurring,
  monthsBetween,
  normalizeRecurrence,
  toPeriod,
} from "../src/lib/recurring";

const FILE =
  "c:\\Users\\miche\\OneDrive\\utenze\\Inviti Helios\\Provvigioni_Giugno_2026_AG_MELFI_PZ4 - FARUOLI MICHELE.xlsx";
const PERIOD = "2026-06";
const SETTLED = "2026-06";
const DRY = process.argv.includes("--dry");

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

function cellStr(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    const o = value as { text?: unknown; result?: unknown };
    if (o.text != null) return String(o.text);
    if (o.result != null) return String(o.result);
  }
  return String(value).trim();
}

function cellNum(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = cellStr(value).replace(",", ".").replace(/[^\d.-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

type VitoRow = {
  name: string;
  pod: string;
  amt: number;
  uso: string;
};

async function loadVitoRows(): Promise<VitoRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fs.readFileSync(FILE) as unknown as ExcelJS.Buffer);
  const sheet = wb.getWorksheet("Foglio2")!;
  const out: VitoRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const collab = cellStr(row.getCell(5).value);
    if (!/postaservice/i.test(collab)) continue;
    const pod = normalizePodKey(cellStr(row.getCell(6).value));
    if (!pod) continue;
    out.push({
      name: cellStr(row.getCell(2).value),
      pod,
      amt: cellNum(row.getCell(4).value),
      uso: cellStr(row.getCell(3).value),
    });
  }
  return out;
}

async function syncMonths(contractId: string, expectedAmount: number) {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: {
      recurrence: true,
      supplyStartDate: true,
      insertionDate: true,
    },
  });
  if (!contract || !isRecurring(normalizeRecurrence(contract.recurrence))) return;
  const start = toPeriod(contract.supplyStartDate ?? contract.insertionDate);
  const now = toPeriod(new Date());
  for (const period of monthsBetween(start, now)) {
    const existing = await prisma.recurringMonth.findUnique({
      where: { contractId_period: { contractId, period } },
    });
    if (
      existing &&
      (existing.status === "PAID" ||
        existing.status === "CLOSED" ||
        existing.status === "ERROR_UNPAID")
    ) {
      continue;
    }
    const status = period < now ? "MISSING" : "PENDING";
    if (existing) {
      await prisma.recurringMonth.update({
        where: { id: existing.id },
        data: { status, amount: expectedAmount },
      });
    } else {
      await prisma.recurringMonth.create({
        data: { contractId, period, status, amount: expectedAmount },
      });
    }
  }
}

async function markJunePaid(contractId: string, amount: number) {
  const existing = await prisma.recurringMonth.findUnique({
    where: { contractId_period: { contractId, period: PERIOD } },
  });
  if (existing?.status === "PAID" && Number(existing.amount) === amount) {
    return "skipped" as const;
  }
  if (existing) {
    await prisma.recurringMonth.update({
      where: { id: existing.id },
      data: {
        status: "PAID",
        paidAt: existing.paidAt ?? new Date(),
        settledPeriod: SETTLED,
        amount,
        note:
          existing.note ??
          "Allineamento Helios giugno 2026 Foglio2 postaservice",
      },
    });
  } else {
    await prisma.recurringMonth.create({
      data: {
        contractId,
        period: PERIOD,
        status: "PAID",
        paidAt: new Date(),
        settledPeriod: SETTLED,
        amount,
        note: "Allineamento Helios giugno 2026 Foglio2 postaservice",
      },
    });
  }
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { status: true },
  });
  await prisma.contract.update({
    where: { id: contractId },
    data: {
      ...(contract?.status === "PROVVIGIONE_LIQUIDATA"
        ? {}
        : { status: "PAGATO_DAL_FORNITORE" }),
      paymentStatus: "Incassato",
      collectionDate: new Date(2026, 5, 1),
      recurrence: "Ricorrente",
    },
  });
  return existing ? ("updated" as const) : ("created" as const);
}

async function main() {
  const vito = await loadVitoRows();
  console.log("Foglio2 postaservice", vito.length, "sum", vito.reduce((s, r) => s + r.amt, 0));
  console.log(DRY ? "DRY RUN" : "APPLY");

  const laforgia = await prisma.user.findFirst({
    where: { name: { equals: "Laforgia Vito", mode: "insensitive" } },
  });
  if (!laforgia) throw new Error("Laforgia non trovato");
  const helios = await prisma.supplier.findFirst({
    where: { name: { equals: "Helios", mode: "insensitive" } },
  });
  if (!helios) throw new Error("Helios non trovato");

  const contracts = await prisma.contract.findMany({
    where: {
      supplierId: helios.id,
      deletedAt: null,
      isHistorical: false,
    },
    include: {
      collaborator: { select: { id: true, name: true } },
      client: true,
      recurringMonths: { where: { period: PERIOD } },
    },
  });
  const byPod = new Map<string, (typeof contracts)[0]>();
  for (const c of contracts) {
    const k = normalizePodKey(c.podPdr || c.pod);
    if (k) byPod.set(k, c);
  }

  const missing: VitoRow[] = [];
  const wrongCollab: Array<VitoRow & { collab: string; contractId: string }> = [];
  const needPaid: Array<VitoRow & { contractId: string; june?: string }> = [];
  const ok: VitoRow[] = [];

  for (const row of vito) {
    const c = byPod.get(row.pod);
    if (!c) {
      missing.push(row);
      continue;
    }
    const june = c.recurringMonths[0];
    const isLaf = c.collaboratorId === laforgia.id;
    const paidOk =
      june?.status === "PAID" && Number(june.amount) === row.amt;
    if (!isLaf) {
      wrongCollab.push({
        ...row,
        collab: c.collaborator.name,
        contractId: c.id,
      });
    } else if (!paidOk) {
      needPaid.push({
        ...row,
        contractId: c.id,
        june: june ? `${june.status}:${june.amount}` : "NO",
      });
    } else {
      ok.push(row);
    }
  }

  console.log("\nOK già Laforgia+PAID corretto:", ok.length);
  console.log("Collaboratore sbagliato:", wrongCollab.length);
  for (const r of wrongCollab) {
    console.log("-", r.name, r.pod, "€", r.amt, "→ ora", r.collab);
  }
  console.log("Laforgia ma June non OK:", needPaid.length);
  for (const r of needPaid) {
    console.log("-", r.name, r.pod, "€", r.amt, "june", r.june);
  }
  console.log("POD assenti nel CRM:", missing.length);
  for (const r of missing) {
    console.log("-", r.name, r.pod, "€", r.amt);
  }

  // Laforgia June PAID che NON sono postaservice in Foglio2
  const vitoPods = new Set(vito.map((r) => r.pod));
  const michele = await prisma.user.findFirst({
    where: {
      OR: [
        { name: { equals: "Michele", mode: "insensitive" } },
        { email: { contains: "faruoli", mode: "insensitive" } },
      ],
    },
  });
  if (!michele) throw new Error("Michele non trovato");

  const lafExtras = await prisma.recurringMonth.findMany({
    where: {
      status: "PAID",
      period: PERIOD,
      contract: {
        collaboratorId: laforgia.id,
        supplierId: helios.id,
        deletedAt: null,
        isHistorical: false,
      },
    },
    include: {
      contract: {
        select: {
          id: true,
          podPdr: true,
          pod: true,
          client: true,
        },
      },
    },
  });
  const extrasToMichele = lafExtras.filter((m) => {
    const pod = normalizePodKey(m.contract.podPdr || m.contract.pod);
    return !pod || !vitoPods.has(pod);
  });
  console.log("\nExtra Laforgia da spostare su Michele:", extrasToMichele.length);
  for (const m of extrasToMichele) {
    console.log(
      "-",
      clientDisplayName(m.contract.client),
      m.contract.podPdr,
      "€",
      Number(m.amount),
    );
  }

  if (DRY) {
    console.log("\nFine dry-run. Riesegui senza --dry per applicare.");
    return;
  }

  let reassigned = 0;
  let paid = 0;
  let amountFixed = 0;
  let movedAway = 0;

  for (const r of wrongCollab) {
    await prisma.contract.update({
      where: { id: r.contractId },
      data: {
        collaboratorId: laforgia.id,
        recurrence: "Ricorrente",
      },
    });
    await syncMonths(r.contractId, r.amt);
    const res = await markJunePaid(r.contractId, r.amt);
    reassigned += 1;
    if (res !== "skipped") paid += 1;
    console.log("REASSIGN", r.name, r.pod, r.collab, "→ Laforgia", res);
  }

  for (const r of needPaid) {
    await syncMonths(r.contractId, r.amt);
    const res = await markJunePaid(r.contractId, r.amt);
    if (res !== "skipped") paid += 1;
    amountFixed += 1;
    console.log("FIX PAID", r.name, r.pod, res);
  }

  for (const m of extrasToMichele) {
    await prisma.contract.update({
      where: { id: m.contract.id },
      data: { collaboratorId: michele.id },
    });
    movedAway += 1;
    console.log(
      "MOVE→Michele",
      clientDisplayName(m.contract.client),
      m.contract.podPdr,
    );
  }

  if (missing.length) {
    console.log(
      "\nATTENZIONE: POD non in CRM, non creati automaticamente:",
      missing.length,
    );
  }

  // Verify
  const after = await prisma.recurringMonth.findMany({
    where: {
      status: "PAID",
      period: PERIOD,
      contract: {
        collaboratorId: laforgia.id,
        supplierId: helios.id,
        deletedAt: null,
        isHistorical: false,
      },
    },
    select: { amount: true },
  });
  const sum = after.reduce((s, x) => s + Number(x.amount), 0);
  console.log("\nRISULTATO Laforgia June PAID:", after.length, "€", sum);
  console.log({ reassigned, paid, amountFixed, movedAway, missing: missing.length });

  // Which of the 100 still not matching?
  const lafPaidPods = new Set(
    (
      await prisma.contract.findMany({
        where: {
          collaboratorId: laforgia.id,
          supplierId: helios.id,
          deletedAt: null,
          isHistorical: false,
          recurringMonths: { some: { period: PERIOD, status: "PAID" } },
        },
        select: { podPdr: true, pod: true },
      })
    ).map((c) => normalizePodKey(c.podPdr || c.pod)),
  );
  const stillMissing = vito.filter((r) => !lafPaidPods.has(r.pod));
  console.log("Ancora fuori dai 100 postaservice:", stillMissing.length);
  for (const r of stillMissing) {
    console.log("-", r.name, r.pod, "€", r.amt);
  }

  const targetOk = after.length === 100 && Math.abs(sum - 454) < 0.01;
  console.log(targetOk ? "OK TARGET 100/€454" : "TARGET NON RAGGIUNTO");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
