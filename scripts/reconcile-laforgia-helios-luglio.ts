import fs from "fs";
import ExcelJS from "exceljs";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import { normalizePodKey } from "../src/lib/storno-status";

const FILE =
  "c:\\Users\\miche\\OneDrive\\utenze\\Inviti Helios\\Provvigioni_Luglio_2026_AG_MELFI_PZ4 - FARUOLI MICHELE.xlsx";
const PERIOD = "2026-07";

function cellStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    const o = v as { text?: unknown; result?: unknown };
    if (o.text != null) return String(o.text);
    if (o.result != null) return String(o.result);
  }
  return String(v).trim();
}
function cellNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(cellStr(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

type Row = { pod: string; name: string; amt: number; collab: string };

async function loadLaforgiaFromExcel(): Promise<Row[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const sheet = wb.getWorksheet("Dettaglio Vendite Dirette")!;
  const out: Row[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const collab = cellStr(row.getCell(2).value).toLowerCase();
    if (collab !== "laforgia") continue;
    const pod = normalizePodKey(cellStr(row.getCell(4).value));
    if (!pod) continue;
    const amt = cellNum(row.getCell(12).value);
    out.push({
      pod,
      name: cellStr(row.getCell(3).value),
      amt: amt > 0 ? amt : 4,
      collab,
    });
  }
  return out;
}

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

async function main() {
  const excel = await loadLaforgiaFromExcel();
  const excelSum = excel.reduce((s, r) => s + r.amt, 0);
  console.log("Excel laforgia:", excel.length, "€", excelSum.toFixed(2));

  const laforgia = await prisma.user.findFirst({
    where: { name: { contains: "Laforgia", mode: "insensitive" } },
  })!;

  const db = await prisma.recurringMonth.findMany({
    where: {
      period: PERIOD,
      status: { in: ["PAID", "LIQUIDATED"] },
      contract: {
        deletedAt: null,
        collaboratorId: laforgia!.id,
        supplier: { name: { contains: "helios", mode: "insensitive" } },
      },
    },
    select: {
      status: true,
      amount: true,
      contract: { select: { podPdr: true, pod: true } },
    },
  });
  const dbMap = new Map(
    db.map((r) => [
      normalizePodKey(r.contract.podPdr ?? r.contract.pod ?? ""),
      r,
    ]),
  );
  const dbSum = db.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  console.log("DB liquidato/incassato:", db.length, "€", dbSum.toFixed(2));

  const missing = excel.filter((r) => !dbMap.has(r.pod));
  const extra = db.filter(
    (r) => !excel.some((e) => e.pod === normalizePodKey(r.contract.podPdr ?? r.contract.pod ?? "")),
  );
  const wrongAmt = excel.filter((r) => {
    const d = dbMap.get(r.pod);
    return d && Math.abs(Number(d.amount ?? 0) - r.amt) > 0.001;
  });

  console.log("\nMancanti in DB:", missing.length, "€", missing.reduce((s, r) => s + r.amt, 0));
  missing.forEach((r) => console.log(" ", r.pod, r.name, r.amt));

  console.log("\nExtra in DB (non in excel laforgia):", extra.length);
  extra.slice(0, 10).forEach((r) =>
    console.log(" ", r.contract.podPdr, r.amount, r.status),
  );

  console.log("\nImporto diverso:", wrongAmt.length);
  wrongAmt.forEach((r) => {
    const d = dbMap.get(r.pod)!;
    console.log(" ", r.pod, "excel", r.amt, "db", d.amount);
  });

  // LIQUIDATED only count
  const liq = db.filter((r) => r.status === "LIQUIDATED");
  const paidOnly = db.filter((r) => r.status === "PAID");
  console.log("\nSolo LIQUIDATED:", liq.length, "€", liq.reduce((s, r) => s + Number(r.amount ?? 0), 0));
  console.log("Solo PAID (da convertire in LIQUIDATED per filtro Pagato):", paidOnly.length);
  for (const r of paidOnly) {
    console.log(" ", r.contract.podPdr ?? r.contract.pod, r.amount);
  }
}

main().finally(() => prisma.$disconnect());
