/**
 * Import solo foglio UTENZE da UTENZE APRILE 2026.xlsx
 * Collaboratore: Michele Faruoli (michele.faruoli@gmail.com)
 *
 * Regole:
 * - Header in riga 4
 * - PROV = data mese/anno → Incassato + collectionDate
 * - HELIOS → ricorrenza mensile
 * - Se POD/PDR confuso (TIM, VODAFONE, ecc.) → salta la riga
 * - Se manca cognome/nome → salta
 */
import "dotenv/config";
import path from "node:path";
import ExcelJS from "exceljs";
import ws from "ws";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import { computeSupplyStartDate } from "../src/lib/supply-dates";

neonConfig.webSocketConstructor = ws;

const FILE =
  process.argv[2] ||
  "c:/Users/miche/OneDrive/BONUS BOOKMAKER/UTENZE APRILE 2026.xlsx";
const MICHELE_EMAIL = "michele.faruoli@gmail.com";
const ARCHIVE_LABEL = "UTENZE APRILE 2026";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL mancante");

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString }),
});

function cellVal(v: unknown): unknown {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object" && v !== null) {
    if ("result" in v) return cellVal((v as { result?: unknown }).result);
    if ("text" in v) return (v as { text?: string }).text ?? null;
    if ("richText" in v) {
      return ((v as { richText: { text: string }[] }).richText ?? [])
        .map((t) => t.text)
        .join("");
    }
  }
  return v;
}

function asString(v: unknown): string {
  const x = cellVal(v);
  if (x == null) return "";
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  return String(x).trim();
}

function parseExcelDate(v: unknown): Date | null {
  const x = cellVal(v);
  if (x instanceof Date && !Number.isNaN(x.getTime())) return x;
  if (typeof x === "number" && x > 20000 && x < 80000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setUTCDate(epoch.getUTCDate() + Math.floor(x));
    return epoch;
  }
  const s = asString(x);
  if (!s) return null;
  // "ok ott" etc → confuso
  if (/[a-zA-Z]{2,}/.test(s) && !/^\d{4}-\d{2}/.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** POD luce IT001E... oppure PDR numerico lungo */
function isValidPodPdr(raw: string): boolean {
  const v = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!v) return false;
  // Brand names / operatori messi per sbaglio nella colonna POD
  const brands = [
    "TIM",
    "VODAFONE",
    "ENEL",
    "FIBRA",
    "WIND",
    "FASTWEB",
    "LINKEM",
    "EOLO",
    "SKY",
  ];
  if (brands.includes(v)) return false;
  if (/^IT001E[A-Z0-9]+$/i.test(v)) return true;
  if (/^IT\d{3}E[A-Z0-9]+$/i.test(v)) return true;
  // PDR gas tipico: 14 cifre circa
  if (/^\d{8,16}$/.test(v)) return true;
  return false;
}

function normalizeSupplier(name: string): string {
  const u = name.trim().toUpperCase();
  const map: Record<string, string> = {
    ENEL: "Enel",
    PLENITUDE: "Plenitude",
    ENI: "Plenitude",
    DOLOMITI: "Dolomiti",
    HELIOS: "Helios",
    ATS: "ATS",
    FIBRA: "Fibra",
    IREN: "Iren",
    EDISON: "Edison",
    A2A: "A2A",
    DUFERCO: "Duferco",
    SORGENIA: "Sorgenia",
    SINERGY: "Sinergy",
  };
  return map[u] ?? (name.trim() || "Sconosciuto");
}

async function main() {
  const michele = await prisma.user.findUnique({
    where: { email: MICHELE_EMAIL },
  });
  if (!michele) {
    throw new Error(`Utente ${MICHELE_EMAIL} non trovato nel CRM`);
  }
  console.log("Collaboratore:", michele.name, michele.id);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.resolve(FILE));
  const sheet =
    wb.worksheets.find((s) => s.name.toUpperCase() === "UTENZE") ??
    wb.worksheets[0];
  console.log("Foglio:", sheet.name);

  // Header row 4
  const headerRow = 4;
  const col = {
    n: 1,
    cognome: 2,
    nome: 3,
    telefono: 4,
    pod: 5,
    consumi: 6,
    dataA: 7,
    dataR: 8,
    utenza: 9,
    fornitore: 10,
    storno: 11,
    prov: 12,
    agenzia: 13,
    note: 15,
  };

  let imported = 0;
  let skipped = 0;
  const skipReasons: Record<string, number> = {};

  function skip(reason: string) {
    skipped += 1;
    skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
  }

  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cognome = asString(row.getCell(col.cognome).value);
    const nome = asString(row.getCell(col.nome).value);
    const telefono = asString(row.getCell(col.telefono).value);
    const podRaw = asString(row.getCell(col.pod).value);
    const fornitoreRaw = asString(row.getCell(col.fornitore).value);
    const utenza = asString(row.getCell(col.utenza).value).toUpperCase();
    const noteExtra = asString(row.getCell(col.note).value);
    const agenzia = asString(row.getCell(col.agenzia).value);
    const consumi = asString(row.getCell(col.consumi).value);

    if (!cognome && !nome) {
      skip("riga vuota");
      continue;
    }
    if (!cognome || !nome) {
      skip("manca cognome o nome");
      continue;
    }
    if (!isValidPodPdr(podRaw)) {
      skip(`POD/PDR non valido: ${podRaw || "(vuoto)"}`);
      continue;
    }
    if (!fornitoreRaw) {
      skip("manca fornitore");
      continue;
    }

    const supplierName = normalizeSupplier(fornitoreRaw);
    const isHelios = supplierName.toUpperCase() === "HELIOS";
    const isBusiness =
      utenza.includes("BUSINESS") || utenza.includes("AZIENDA");

    const insertionDate =
      parseExcelDate(row.getCell(col.dataA).value) ??
      parseExcelDate(row.getCell(col.dataR).value) ??
      new Date();
    const supplyStartDate =
      parseExcelDate(row.getCell(col.dataR).value) ??
      computeSupplyStartDate(insertionDate, "CAMBIO");

    const provDate = parseExcelDate(row.getCell(col.prov).value);
    const paid = Boolean(provDate);

    const podPdr = podRaw.trim().toUpperCase().replace(/\s+/g, "");
    const externalId = `utenze-apr2026-${podPdr}`;

    // Evita doppioni stesso POD in questo lotto
    const existing = await prisma.contract.findFirst({
      where: {
        OR: [{ externalId }, { podPdr, collaboratorId: michele.id }],
      },
    });
    if (existing) {
      skip(`già presente POD ${podPdr}`);
      continue;
    }

    let supplier = await prisma.supplier.findFirst({
      where: { name: { equals: supplierName, mode: "insensitive" } },
    });
    if (!supplier) {
      const code =
        supplierName
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, "_")
          .slice(0, 30) || "SUP";
      supplier = await prisma.supplier.create({
        data: {
          name: supplierName,
          code: `${code}_${Date.now().toString(36)}`,
        },
      });
    }

    const client = await prisma.client.create({
      data: {
        type: isBusiness ? "AZIENDA" : "PRIVATO",
        firstName: isBusiness ? null : nome,
        lastName: isBusiness ? null : cognome,
        companyName: isBusiness ? `${cognome} ${nome}`.trim() : null,
        phone: telefono || null,
        createdById: michele.id,
        notes: [agenzia && `Agenzia: ${agenzia}`, noteExtra]
          .filter(Boolean)
          .join(" · ") || null,
      },
    });

    const year = new Date().getFullYear();
    const contractNumber = `CTR-${year}-UA${String(r).padStart(4, "0")}-${Math.floor(
      Math.random() * 900 + 100,
    )}`;

    const recurrence = isHelios ? "Ricorrente" : "Una tantum";
    const notes = [
      consumi && `Consumi: ${consumi}`,
      agenzia && `Agenzia: ${agenzia}`,
      noteExtra,
      isHelios && "Helios: ricorrenza mensile",
    ]
      .filter(Boolean)
      .join(" · ");

    const contract = await prisma.contract.create({
      data: {
        contractNumber,
        externalId,
        clientId: client.id,
        collaboratorId: michele.id,
        supplierId: supplier.id,
        status: paid ? "PAGATO_DAL_FORNITORE" : "ATTIVATO",
        utilityType: isHelios
          ? "Luce"
          : podPdr.startsWith("IT")
            ? "Luce"
            : /^\d+$/.test(podPdr)
              ? "Gas"
              : null,
        podPdr,
        recurrence,
        operationType: "CAMBIO",
        agency: agenzia || null,
        insertionDate,
        supplyStartDate,
        activationDate: parseExcelDate(row.getCell(col.dataR).value),
        paymentStatus: paid ? "Incassato" : "Da incassare",
        collectionDate: provDate,
        isHistorical: false,
        archiveLabel: ARCHIVE_LABEL,
        commissionConfirmed: paid,
        commissionConfirmedAt: paid ? provDate : null,
        notes: notes || null,
      },
    });

    await prisma.commission.create({
      data: {
        contractId: contract.id,
        expected: 0,
        received: paid ? 0 : 0,
        paid: 0,
        accrued: 0,
      },
    });

    imported += 1;
  }

  console.log("\n=== RISULTATO ===");
  console.log("Importati:", imported);
  console.log("Saltati:", skipped);
  console.log("Motivi skip:", skipReasons);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
