/**
 * Riallinea date Laforgia (fix timezone -1 giorno) da Excel UT GEN 2026.
 * Uso: npx tsx scripts/fix-laforgia-dates-tz.ts
 */
import "dotenv/config";
import ExcelJS from "exceljs";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

const SRC_XLSX = "C:/Users/miche/Downloads/UT GEN 2026.xlsx";

/** Salva sempre mezzogiorno UTC del giorno civile → niente -1 giorno in toISOString. */
function utcNoon(y: number, m0: number, d: number): Date {
  return new Date(Date.UTC(y, m0, d, 12, 0, 0));
}

function cellStr(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof v === "object") {
    const o = v as { text?: unknown; result?: unknown; richText?: { text?: string }[] };
    if (Array.isArray(o.richText)) return o.richText.map((t) => t.text ?? "").join("");
    if (o.text != null) return cellStr(o.text);
    if (o.result != null) return cellStr(o.result);
  }
  return String(v).trim();
}

function cellDate(v: unknown): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // ExcelJS spesso dà UTC midnight del giorno Excel
    return utcNoon(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate());
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const epoch = Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000;
    const d = new Date(epoch);
    return utcNoon(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  const s = cellStr(v);
  if (!s || s === "-" || /^ko$/i.test(s)) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split("-").map(Number);
    return utcNoon(y!, m! - 1, d!);
  }
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return utcNoon(+m[3]!, +m[2]! - 1, +m[1]!);
  const m2 = s.match(/^(\d{1,2})[\/\-.](\d{4})$/);
  if (m2) return utcNoon(+m2[2]!, +m2[1]! - 1, 1);
  return null;
}

function normalizePod(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SRC_XLSX);
  const sheet = wb.worksheets[0]!;
  const headers: string[] = [];
  sheet.getRow(1).eachCell((c, col) => {
    headers[col] = cellStr(c.value).toLowerCase();
  });
  const findExact = (...names: string[]) => {
    for (const n of names) {
      const i = headers.findIndex((h) => h === n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const colPod = findExact("pod/pdr", "pod", "pdr");
  const colIns = findExact("caricato");
  const colSupply = findExact("esecutivo");
  const colPay = findExact("commissioni");

  const excel = new Map<
    string,
    { insertionDate: Date | null; supplyStartDate: Date | null; collectionDate: Date | null }
  >();
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const pod = normalizePod(cellStr(row.getCell(colPod).value));
    if (!pod) continue;
    const insertionDate = cellDate(row.getCell(colIns).value);
    const esecutivo = cellDate(row.getCell(colSupply).value);
    const commissioni = cellDate(row.getCell(colPay).value);
    const supplyStartDate = esecutivo ?? commissioni;
    const collectionDate = commissioni ?? supplyStartDate;
    excel.set(pod, { insertionDate, supplyStartDate, collectionDate });
  }

  const laforgia = await prisma.user.findFirst({
    where: { name: { equals: "Laforgia Vito", mode: "insensitive" } },
    select: { id: true },
  });
  if (!laforgia) throw new Error("Laforgia non trovato");

  const rows = await prisma.contract.findMany({
    where: {
      collaboratorId: laforgia.id,
      deletedAt: null,
      isHistorical: false,
      archiveLabel: "Laforgia da archivio",
    },
    select: { id: true, podPdr: true },
  });

  let fixed = 0;
  for (const c of rows) {
    const pod = normalizePod(c.podPdr || "");
    const x = excel.get(pod);
    if (!x) continue;
    const insertionDate = x.insertionDate ?? undefined;
    const supplyStartDate = x.supplyStartDate ?? undefined;
    const collectionDate =
      x.collectionDate ?? supplyStartDate ?? insertionDate ?? undefined;

    await prisma.contract.update({
      where: { id: c.id },
      data: {
        ...(insertionDate ? { insertionDate } : {}),
        ...(supplyStartDate ? { supplyStartDate } : {}),
        ...(collectionDate ? { collectionDate } : {}),
      },
    });
    fixed++;
    if (fixed <= 8) {
      console.log(
        `${pod} ins=${insertionDate?.toISOString().slice(0, 10)} supply=${supplyStartDate?.toISOString().slice(0, 10)} coll=${collectionDate?.toISOString().slice(0, 10)}`,
      );
    }
  }
  console.log(`Date riallineate: ${fixed}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
