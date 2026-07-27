/**
 * Pulizia post-sync Helios:
 * - elimina POD spurio
 * - riclassifica PRIVATO vs AZIENDA da intestatario
 * - forza anagrafica dedicata (niente cloni) su tutti i Helios
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import { normalizePodKey } from "../src/lib/storno-status";
import { parsePrivatoDisplayName, clientDisplayName } from "../src/lib/utils";
import {
  guessCompetenceFromFilename,
  periodFromSheetName,
} from "../src/lib/helios-provvigioni-shared";

const DIR = "c:\\Users\\miche\\OneDrive\\utenze\\Inviti Helios";
const FILES = [
  "Provvigioni_Dicembre_2025_a_Febbraio_2026_AG_MELFI_PZ4 - FARUOLI MICHELE.xlsx",
  "Provvigioni_Marzo_2026_AG_MELFI_PZ4 - FARUOLI MICHELE.xlsx",
  "Provvigioni_Aprile_2026_AG_MELFI_PZ4 - FARUOLI MICHELE.xlsx",
  "Provvigioni_Maggio_2026_AG_MELFI_PZ4 - FARUOLI MICHELE.xlsx",
  "Provvigioni_Giugno_2026_AG_MELFI_PZ4 - FARUOLI MICHELE.xlsx",
];

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

function cellStr(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const o = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: string }> };
    if (Array.isArray(o.richText)) return o.richText.map((t) => t.text ?? "").join("");
    if (o.text != null) return cellStr(o.text);
    if (o.result != null) return cellStr(o.result);
  }
  return String(value).trim();
}

function headerIndex(headers: Array<string | undefined>, ...names: string[]): number {
  for (const name of names) {
    const i = headers.findIndex((h) => h != null && h === name);
    if (i >= 0) return i;
  }
  for (const name of names) {
    const i = headers.findIndex((h) => h != null && h.includes(name));
    if (i >= 0) return i;
  }
  return -1;
}

function isValidPod(pod: string): boolean {
  if (!pod) return false;
  if (/^IT\d{3}E[A-Z0-9]+$/i.test(pod)) return true;
  if (/^\d{8,16}$/.test(pod)) return true;
  return false;
}

function isCompanyName(name: string, utilizzo: string): boolean {
  const u = utilizzo.toUpperCase();
  if (u.includes("ALTRI") || u.includes("BUSINESS")) return true;
  return /\b(SRL|S\.R\.L\.|SRLS|SNC|SAS|SPA|S\.P\.A\.|APS|ASD|SS|CONDOMINIO|COOPERATIVA|SOC\.|SOCIETA|SOCIETÀ)\b/i.test(
    name,
  );
}

function parseFields(intestatario: string, utilizzo: string) {
  const raw = intestatario.trim().replace(/\s+/g, " ").toUpperCase();
  if (isCompanyName(raw, utilizzo)) {
    return {
      type: "AZIENDA" as const,
      companyName: raw,
      firstName: null,
      lastName: null,
    };
  }
  const p = parsePrivatoDisplayName(raw);
  return {
    type: "PRIVATO" as const,
    lastName: p.lastName.toUpperCase(),
    firstName: p.firstName ? p.firstName.toUpperCase() : null,
    companyName: null,
  };
}

async function loadByPod(): Promise<Map<string, { intestatario: string; utilizzo: string }>> {
  const map = new Map<string, { intestatario: string; utilizzo: string }>();
  for (const fileName of FILES) {
    const filePath = path.join(DIR, fileName);
    if (!fs.existsSync(filePath)) continue;
    const fallback = guessCompetenceFromFilename(fileName) ?? "2026-06";
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    for (const sheet of wb.worksheets) {
      if (/riepilogo/i.test(sheet.name)) continue;
      const headers: Array<string | undefined> = [];
      sheet.getRow(1).eachCell((c, col) => {
        headers[col] = cellStr(c.value).toLowerCase();
      });
      const colPod = headerIndex(headers, "cod.ute.", "cod.ute", "pod");
      if (colPod < 0) continue;
      const colName = headerIndex(headers, "intestatario contratto", "intestatario");
      const colUtilizzo = headerIndex(headers, "utilizzo");
      void fallback;
      for (let r = 2; r <= sheet.rowCount; r++) {
        const row = sheet.getRow(r);
        if (!row.hasValues) continue;
        const pod = normalizePodKey(cellStr(row.getCell(colPod).value));
        if (!isValidPod(pod)) continue;
        const intestatario = colName >= 0 ? cellStr(row.getCell(colName).value) : "";
        const utilizzo = colUtilizzo >= 0 ? cellStr(row.getCell(colUtilizzo).value) : "";
        if (!intestatario) continue;
        map.set(pod, { intestatario, utilizzo });
      }
    }
  }
  return map;
}

async function main() {
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", active: true },
    orderBy: { createdAt: "asc" },
  });
  if (!admin) throw new Error("Admin missing");

  // Soft-delete POD spurio
  const bad = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      OR: [
        { podPdr: { in: ["55", "79"] } },
        { pod: { in: ["55", "79"] } },
      ],
    },
  });
  for (const b of bad) {
    await prisma.contract.update({
      where: { id: b.id },
      data: {
        deletedAt: new Date(),
        internalNotes: "POD spurio rimosso (sync Helios)",
      },
    });
    console.log("🗑 rimosso", b.podPdr);
  }

  const byPod = await loadByPod();
  console.log("POD validi da Excel:", byPod.size);

  const helios = await prisma.supplier.findFirst({
    where: { name: { equals: "Helios", mode: "insensitive" } },
  });
  if (!helios) throw new Error("Helios missing");

  const contracts = await prisma.contract.findMany({
    where: {
      supplierId: helios.id,
      deletedAt: null,
      isHistorical: false,
    },
    select: {
      id: true,
      clientId: true,
      podPdr: true,
      pod: true,
      client: {
        select: {
          phone: true,
          type: true,
          firstName: true,
          lastName: true,
          companyName: true,
        },
      },
    },
  });

  let fixed = 0;
  let split = 0;

  for (const c of contracts) {
    const pod = normalizePodKey(c.podPdr || c.pod);
    if (!isValidPod(pod)) {
      await prisma.contract.update({
        where: { id: c.id },
        data: {
          deletedAt: new Date(),
          internalNotes: "POD non valido rimosso",
        },
      });
      continue;
    }
    const fromFile = byPod.get(pod);
    if (!fromFile) continue;

    const fields = parseFields(fromFile.intestatario, fromFile.utilizzo);
    const otherCount = await prisma.contract.count({
      where: { clientId: c.clientId, id: { not: c.id }, deletedAt: null },
    });

    if (otherCount > 0) {
      const created = await prisma.client.create({
        data: {
          type: fields.type,
          firstName: fields.firstName,
          lastName: fields.lastName,
          companyName: fields.companyName,
          phone: c.client.phone,
          createdById: admin.id,
          notes: "Anagrafica dedicata Helios (no clone)",
        },
      });
      await prisma.contract.update({
        where: { id: c.id },
        data: { clientId: created.id },
      });
      split++;
    } else {
      await prisma.client.update({
        where: { id: c.clientId },
        data: {
          type: fields.type,
          firstName: fields.firstName,
          lastName: fields.lastName,
          companyName: fields.companyName,
        },
      });
      fixed++;
    }
  }

  // Verifica cloni rimasti
  const after = await prisma.contract.findMany({
    where: { supplierId: helios.id, deletedAt: null, isHistorical: false },
    select: { clientId: true, podPdr: true, client: { select: { firstName: true, lastName: true, companyName: true, type: true } } },
  });
  const byClient = new Map<string, number>();
  for (const a of after) byClient.set(a.clientId, (byClient.get(a.clientId) ?? 0) + 1);
  const stillShared = [...byClient.values()].filter((n) => n > 1).length;

  console.log("\n=== PULIZIA ===");
  console.log({
    nomiAggiornati: fixed,
    anagraficheSeparate: split,
    ancoraCondivisi: stillShared,
    esempi: after.slice(0, 8).map((a) => `${a.podPdr} → ${clientDisplayName(a.client)}`),
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
