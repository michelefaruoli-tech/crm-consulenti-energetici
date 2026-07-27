/**
 * Laforgia Vito: sposta contratti da Archivio → Provvigioni (Pagato)
 * e corregge date da Excel «UT GEN 2026.xlsx»:
 *   CARICATO → insertionDate
 *   ESECUTIVO → supplyStartDate (se manca → COMMISSIONI)
 *   COMMISSIONI → collectionDate (incasso; se manca → supplyStartDate)
 *
 * I gemelli attivi duplicati (stesso POD, date errate 2026-07-25) vengono soft-delete.
 *
 * Uso: npx tsx scripts/migrate-laforgia-archivio-to-pagato.ts
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

function cellStr(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as {
      text?: unknown;
      result?: unknown;
      richText?: { text?: string }[];
    };
    if (Array.isArray(o.richText)) {
      return o.richText.map((t) => t.text ?? "").join("");
    }
    if (o.text != null) return cellStr(o.text);
    if (o.result != null) return cellStr(o.result);
  }
  return String(v).trim();
}

function cellDate(v: unknown): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setUTCDate(epoch.getUTCDate() + Math.floor(v));
    return new Date(epoch.getUTCFullYear(), epoch.getUTCMonth(), epoch.getUTCDate());
  }
  const s = cellStr(v);
  if (!s || s === "-" || /^ko$/i.test(s)) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split("-").map(Number);
    return new Date(y!, m! - 1, d!);
  }
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return new Date(+m[3]!, +m[2]! - 1, +m[1]!);
  const m2 = s.match(/^(\d{1,2})[\/\-.](\d{4})$/);
  if (m2) return new Date(+m2[2]!, +m2[1]! - 1, 1);
  return null;
}

function normalizePod(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

type ExcelRow = {
  insertionDate: Date | null;
  supplyStartDate: Date | null;
  collectionDate: Date | null;
};

async function loadExcelByPod(): Promise<Map<string, ExcelRow>> {
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
  if (colPod < 0) throw new Error("Colonna POD/PDR non trovata in Excel");

  const byPod = new Map<string, ExcelRow>();
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const pod = normalizePod(cellStr(row.getCell(colPod).value));
    if (!pod) continue;
    const insertionDate =
      colIns >= 0 ? cellDate(row.getCell(colIns).value) : null;
    const esecutivo =
      colSupply >= 0 ? cellDate(row.getCell(colSupply).value) : null;
    const commissioni =
      colPay >= 0 ? cellDate(row.getCell(colPay).value) : null;
    // Utente: colonna COMMISSIONI/PROV ≈ inizio fornitura se manca ESECUTIVO
    const supplyStartDate = esecutivo ?? commissioni;
    const collectionDate = commissioni ?? supplyStartDate;
    byPod.set(pod, { insertionDate, supplyStartDate, collectionDate });
  }
  return byPod;
}

async function main() {
  const excel = await loadExcelByPod();
  const laforgia = await prisma.user.findFirst({
    where: { name: { equals: "Laforgia Vito", mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!laforgia) throw new Error("Collaboratore Laforgia Vito non trovato");

  const hist = await prisma.contract.findMany({
    where: {
      collaboratorId: laforgia.id,
      isHistorical: true,
      deletedAt: null,
    },
    select: {
      id: true,
      podPdr: true,
      commission: { select: { id: true, expected: true, paid: true, received: true } },
    },
  });

  console.log(`Archivio Laforgia: ${hist.length}`);
  console.log(`Excel POD: ${excel.size}`);

  let updated = 0;
  let skippedNoExcel = 0;
  const restoredPods = new Set<string>();

  for (const c of hist) {
    const pod = normalizePod(c.podPdr || "");
    const x = pod ? excel.get(pod) : undefined;
    if (!x) {
      skippedNoExcel++;
      continue;
    }

    const insertionDate = x.insertionDate ?? undefined;
    const supplyStartDate = x.supplyStartDate ?? undefined;
    const collectionDate = x.collectionDate ?? supplyStartDate ?? insertionDate;

    await prisma.contract.update({
      where: { id: c.id },
      data: {
        isHistorical: false,
        archiveLabel: "Laforgia da archivio",
        status: "PROVVIGIONE_LIQUIDATA",
        paymentStatus: "Incassato",
        ...(insertionDate ? { insertionDate } : {}),
        ...(supplyStartDate ? { supplyStartDate } : {}),
        ...(collectionDate ? { collectionDate } : {}),
      },
    });

    if (c.commission) {
      const expected = Number(c.commission.expected ?? 0) || 0;
      // Se c’è gettone, allinea received/paid (liquidato)
      if (expected > 0) {
        await prisma.commission.update({
          where: { id: c.commission.id },
          data: {
            received: expected,
            paid: expected,
          },
        });
      }
    }

    if (pod) restoredPods.add(pod);
    updated++;
    if (updated <= 10) {
      console.log(
        `  ok ${pod} ins=${insertionDate?.toISOString().slice(0, 10) ?? "-"} supply=${supplyStartDate?.toISOString().slice(0, 10) ?? "-"} coll=${collectionDate?.toISOString().slice(0, 10) ?? "-"}`,
      );
    }
  }

  // Soft-delete gemelli attivi duplicati (stesso POD, ancora con date errate tipiche import)
  const twins = await prisma.contract.findMany({
    where: {
      collaboratorId: laforgia.id,
      isHistorical: false,
      deletedAt: null,
      id: { notIn: hist.map((h) => h.id) },
      podPdr: { in: [...restoredPods] },
    },
    select: {
      id: true,
      podPdr: true,
      insertionDate: true,
      archiveLabel: true,
    },
  });

  let deletedTwins = 0;
  for (const t of twins) {
    const pod = normalizePod(t.podPdr || "");
    if (!restoredPods.has(pod)) continue;
    // Solo i duplicati “import Collaboratori” del 2026-07-25 (date errate)
    const ins = t.insertionDate.toISOString().slice(0, 10);
    const isJunk =
      ins === "2026-07-25" ||
      (t.archiveLabel ?? "").toLowerCase() === "collaboratori";
    if (!isJunk) continue;

    await prisma.contract.update({
      where: { id: t.id },
      data: {
        deletedAt: new Date(),
        archiveLabel: "Duplicato rimosso (Laforgia restore)",
      },
    });
    deletedTwins++;
  }

  console.log(
    `Completato: ${updated} → Provvigioni Pagato · skip Excel ${skippedNoExcel} · duplicati soft-delete ${deletedTwins}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
