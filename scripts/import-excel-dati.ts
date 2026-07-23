/**
 * Import foglio "Dati" da Rendiconto Excel.
 *
 * Uso:
 *   npx tsx scripts/import-excel-dati.ts
 *   npx tsx scripts/import-excel-dati.ts --file import/Rendiconto_Contratti_Database.xlsx
 */
import "dotenv/config";
import path from "node:path";
import ExcelJS from "exceljs";
import bcrypt from "bcryptjs";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { PrismaClient, ContractStatus } from "../src/generated/prisma/client";

neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString || connectionString.includes("user:password@host")) {
  throw new Error("DATABASE_URL non configurata");
}

const adapter = new PrismaNeon({ connectionString });
const prisma = new PrismaClient({ adapter });

type Row = Record<string, unknown>;

function cell(row: Row, key: string): string {
  const v = row[key];
  if (v == null || v === "") return "";
  if (typeof v === "object" && v !== null && "text" in (v as object)) {
    return String((v as { text?: string }).text ?? "").trim();
  }
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const s = String(value).trim();
  if (!s) return null;
  // Excel serial number
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      epoch.setUTCDate(epoch.getUTCDate() + Math.floor(n));
      return epoch;
    }
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const s = String(value).replace(",", ".").replace(/[^\d.-]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Evita overflow Decimal(10,x) da celle Excel sporche */
function safeMoney(value: unknown, max = 999999.99): number | null {
  const n = parseNumber(value);
  if (n == null) return null;
  if (Math.abs(n) > max) return null;
  return Math.round(n * 100) / 100;
}

function safeRate(value: unknown, max = 999.9999): number | null {
  const n = parseNumber(value);
  if (n == null) return null;
  if (Math.abs(n) > max) return null;
  return n;
}

function normalizeSupplier(name: string): { name: string; code: string } {
  const raw = name.trim() || "SCONOSCIUTO";
  const upper = raw.toUpperCase();
  const aliases: Record<string, string> = {
    ENEL: "Enel",
    "ENI PLENITUDE": "Plenitude",
    ENI: "Plenitude",
    PLENITUDE: "Plenitude",
    DOLOMITI: "Dolomiti",
    IREN: "Iren",
    EDISON: "Edison",
    HELIOS: "Helios",
    A2A: "A2A",
    VODAFONE: "Vodafone",
    FIBRA: "Fibra",
    ATS: "ATS",
    DUFERCO: "Duferco",
    ETRURIA: "Etruria",
    SORGENIA: "Sorgenia",
    SINERGY: "Sinergy",
    POS: "POS",
  };
  const mapped = aliases[upper] ?? raw;
  const code = mapped
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40) || "SCONOSCIUTO";
  return { name: mapped, code };
}

function mapClientType(value: string): "PRIVATO" | "AZIENDA" {
  const v = value.toUpperCase();
  if (v.includes("BUSINESS") || v.includes("AZIENDA") || v === "BOX") return "AZIENDA";
  return "PRIVATO";
}

function mapStatus(row: Row): ContractStatus {
  const pay = cell(row, "statoPagamento").toLowerCase();
  const work = cell(row, "statoLavorazione").toLowerCase();
  if (pay.includes("incassato")) return "PAGATO_DAL_FORNITORE";
  if (pay.includes("da_incassare") || pay.includes("da incassare")) return "IN_ATTESA_PAGAMENTO";
  if (work.includes("lavorare")) return "IN_LAVORAZIONE";
  return "INSERITO";
}

function commissionAmount(row: Row): number {
  return (
    safeMoney(row.valore) ??
    safeMoney(row.valoreUnaTantum) ??
    safeMoney(row.valoreMensile) ??
    0
  );
}

async function ensureCollaborator(email: string, adminId: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return adminId;
  }

  const existing = await prisma.user.findUnique({ where: { email: normalized } });
  if (existing) return existing.id;

  const nameGuess = normalized.split("@")[0].replace(/[._]/g, " ");
  const password = await bcrypt.hash(`Temp${Math.random().toString(36).slice(2, 10)}!`, 10);
  const created = await prisma.user.create({
    data: {
      email: normalized,
      name: nameGuess,
      role: "COLLABORATORE",
      password,
      active: true,
    },
  });
  console.log(`  + collaboratore creato: ${normalized}`);
  return created.id;
}

async function ensureSupplier(name: string) {
  const { name: display, code } = normalizeSupplier(name);
  const existing = await prisma.supplier.findUnique({ where: { code } });
  if (existing) return existing.id;
  const created = await prisma.supplier.create({
    data: { name: display, code, active: true },
  });
  return created.id;
}

async function findOrCreateClient(
  row: Row,
  collaboratorId: string,
): Promise<string> {
  const firstName = cell(row, "nomeCliente") || null;
  const lastName = cell(row, "cognomeCliente") || null;
  const fiscalCode = cell(row, "cf").toUpperCase() || null;
  const vatNumber = cell(row, "partitaIva") || null;
  const email = cell(row, "emailCliente").toLowerCase() || null;
  const type = mapClientType(cell(row, "tipoCliente"));

  if (fiscalCode) {
    const found = await prisma.client.findFirst({ where: { fiscalCode } });
    if (found) return found.id;
  }
  if (vatNumber) {
    const found = await prisma.client.findFirst({ where: { vatNumber } });
    if (found) return found.id;
  }
  if (firstName && lastName) {
    const found = await prisma.client.findFirst({
      where: {
        firstName: { equals: firstName, mode: "insensitive" },
        lastName: { equals: lastName, mode: "insensitive" },
        phone: cell(row, "telefono") || undefined,
      },
    });
    if (found) return found.id;
  }

  const created = await prisma.client.create({
    data: {
      type,
      firstName,
      lastName,
      companyName: type === "AZIENDA" ? [firstName, lastName].filter(Boolean).join(" ") : null,
      fiscalCode,
      vatNumber,
      email,
      pec: cell(row, "pec") || null,
      phone: cell(row, "telefono") || null,
      iban: cell(row, "iban") || null,
      address: cell(row, "indirizzo") || null,
      city: cell(row, "citta") || null,
      province: cell(row, "provincia") || null,
      region: cell(row, "regione") || null,
      zipCode: cell(row, "cap") || null,
      classification: cell(row, "classificazione") || null,
      supplyAddress: cell(row, "indirizzoFornitura") || null,
      supplyCity: cell(row, "cittaFornitura") || null,
      supplyProvince: cell(row, "provinciaFornitura") || null,
      supplyRegion: cell(row, "regioneFornitura") || null,
      supplyZipCode: cell(row, "capFornitura") || null,
      addressesMatch:
        cell(row, "indirizziCoincidono").toLowerCase() === "true" ||
        cell(row, "indirizziCoincidono") === "1" ||
        null,
      createdById: collaboratorId,
    },
  });
  return created.id;
}

async function main() {
  const fileArg = process.argv.find((a) => a.startsWith("--file="))?.split("=")[1];
  const filePath = path.resolve(
    fileArg ?? "import/Rendiconto_Contratti_Database.xlsx",
  );

  console.log("Lettura:", filePath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet("Dati");
  if (!sheet) throw new Error('Foglio "Dati" non trovato');

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (c, col) => {
    headers[col] = String(c.value ?? "").trim();
  });

  const admin =
    (await prisma.user.findFirst({ where: { role: "ADMIN", active: true } })) ??
    (await prisma.user.findFirst({ where: { active: true } }));
  if (!admin) throw new Error("Nessun utente admin attivo nel DB");

  let imported = 0;
  let skipped = 0;
  let updated = 0;

  for (let r = 2; r <= sheet.rowCount; r++) {
    const excelRow = sheet.getRow(r);
    const externalId = String(excelRow.getCell(1).value ?? "").trim();
    if (!externalId) continue;

    const row: Row = {};
    for (let col = 1; col < headers.length; col++) {
      const key = headers[col];
      if (!key) continue;
      row[key] = excelRow.getCell(col).value;
    }

    const existing = await prisma.contract.findUnique({ where: { externalId } });
    if (existing) {
      skipped++;
      continue;
    }

    const collabEmail = cell(row, "collaboratore").toLowerCase();
    const collaboratorId = await ensureCollaborator(collabEmail, admin.id);
    const clientId = await findOrCreateClient(row, collaboratorId);
    const supplierId = await ensureSupplier(cell(row, "fornitore"));
    const amount = commissionAmount(row);
    const status = mapStatus(row);
    const insertionDate = parseDate(row.dataInserimento) ?? new Date();
    const contractNumber = externalId.length <= 60 ? externalId : `IMP-${externalId.slice(-50)}`;

    const confirmed =
      cell(row, "verificatoManualmente").toLowerCase() === "true" ||
      cell(row, "verificatoManualmente") === "1";

    try {
      await prisma.$transaction(async (tx) => {
      const contract = await tx.contract.create({
        data: {
          externalId,
          contractNumber,
          clientId,
          collaboratorId,
          supplierId,
          status,
          utilityType: cell(row, "tipoContratto") || null,
          productName: cell(row, "prodotto") || null,
          podPdr: cell(row, "podpdr") || null,
          priceType: cell(row, "tipoPrezzo") || null,
          pcv: safeRate(row.pcv),
          pricePerKwh: safeRate(row.prezzoKw, 99.999999),
          bandCount: (() => {
            const n = parseNumber(row.numeroFasce);
            if (n == null || n < 0 || n > 20) return null;
            return Math.round(n);
          })(),
          bandsJson: cell(row, "fasceOrarie") || null,
          recurrence: cell(row, "ricorrenza") || null,
          paymentMethod: cell(row, "metodoPagamento") || null,
          operationType: cell(row, "operazione") || null,
          agency: cell(row, "agenzia") || null,
          rowType: cell(row, "tipoRiga") || null,
          parentExternalId: cell(row, "parentId") || null,
          monthlyPeriod: cell(row, "periodoMensile") || null,
          insertionDate,
          receivedDate: parseDate(row.dataRicezione),
          collectionDate: parseDate(row.dataIncasso),
          expiryDate: parseDate(row.dataScadenza),
          stornoEndDate: parseDate(row.dataFineStorno),
          workEmailDate: parseDate(row.dataEmailLavorazione),
          paymentStatus: cell(row, "statoPagamento") || null,
          workStatus: cell(row, "statoLavorazione") || null,
          toWork:
            cell(row, "daLavorare").toLowerCase() === "true" ||
            cell(row, "daLavorare") === "1",
          manuallyVerified: confirmed,
          commissionConfirmed: confirmed,
          commissionConfirmedAt: confirmed ? new Date() : null,
          attachmentsJson: cell(row, "allegatiJson") || null,
          notes: cell(row, "note") || null,
        },
      });

      await tx.contractStatusHistory.create({
        data: {
          contractId: contract.id,
          toStatus: status,
          changedById: admin.id,
          note: "Import Excel foglio Dati",
        },
      });

      await tx.commission.create({
        data: {
          contractId: contract.id,
          expected: amount,
          accrued: status === "PAGATO_DAL_FORNITORE" ? amount : 0,
          received: status === "PAGATO_DAL_FORNITORE" ? amount : 0,
          paid: 0,
        },
      });
      });

      imported++;
      if (imported % 50 === 0) console.log(`  ... ${imported} importati`);
    } catch (err) {
      console.error(`  ! riga ${r} id=${externalId}:`, err instanceof Error ? err.message : err);
      skipped++;
    }
  }

  console.log("\nImport completato.");
  console.log(`  importati: ${imported}`);
  console.log(`  già presenti (skip): ${skipped}`);
  console.log(`  aggiornati: ${updated}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
