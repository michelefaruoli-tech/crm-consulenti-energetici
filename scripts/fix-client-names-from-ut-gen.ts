/**
 * Completa nome/cognome clienti in Provvigioni da UT GEN 2026.xlsx (match POD).
 *
 * Uso: npx tsx scripts/fix-client-names-from-ut-gen.ts [percorso.xlsx]
 */
import "dotenv/config";
import ExcelJS from "exceljs";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import { clientDisplayName } from "../src/lib/utils";
import { normalizePodKey } from "../src/lib/storno-status";

const DEFAULT_XLSX = "c:\\Users\\miche\\Downloads\\UT GEN 2026.xlsx";

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

function cellStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object" && v !== null) {
    const o = v as { text?: unknown; result?: unknown };
    if (o.text != null) return cellStr(o.text);
    if (o.result != null) return cellStr(o.result);
  }
  return String(v).trim();
}

function needsNameFix(firstName: string | null, lastName: string | null): boolean {
  const first = (firstName ?? "").trim();
  const last = (lastName ?? "").trim();
  if (!last) return true;
  if (!first) return true;
  if (first.localeCompare(last, "it", { sensitivity: "accent" }) === 0) return true;
  return false;
}

async function loadExcelByPod(
  filePath: string,
): Promise<Map<string, { lastName: string; firstName: string | null }>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheet =
    wb.worksheets.find((s) => s.name.toUpperCase() === "UTENZE") ??
    wb.worksheets[0];
  if (!sheet) throw new Error("Foglio UTENZE non trovato");

  const map = new Map<string, { lastName: string; firstName: string | null }>();
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const pod = normalizePodKey(cellStr(row.getCell(5).value));
    const lastName = cellStr(row.getCell(2).value).toUpperCase();
    const firstNameRaw = cellStr(row.getCell(3).value);
    const firstName = firstNameRaw ? firstNameRaw.toUpperCase() : null;
    if (!pod || !lastName) continue;
    map.set(pod, { lastName, firstName });
  }
  return map;
}

async function main() {
  const filePath = process.argv[2] ?? DEFAULT_XLSX;
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", active: true },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!admin) throw new Error("Nessun admin attivo per createdById");

  const byPod = await loadExcelByPod(filePath);
  console.log("File:", filePath);
  console.log("POD nel file:", byPod.size);

  const contracts = await prisma.contract.findMany({
    where: { deletedAt: null, isHistorical: false },
    select: {
      id: true,
      podPdr: true,
      pod: true,
      pdr: true,
      clientId: true,
      client: {
        select: {
          id: true,
          type: true,
          firstName: true,
          lastName: true,
          companyName: true,
          fiscalCode: true,
          vatNumber: true,
          email: true,
          pec: true,
          phone: true,
          iban: true,
          address: true,
          street: true,
          streetNumber: true,
          city: true,
          province: true,
          region: true,
          zipCode: true,
          country: true,
          classification: true,
          legalFirstName: true,
          legalLastName: true,
          legalFiscalCode: true,
          sdiCode: true,
          supplyAddress: true,
          supplyStreet: true,
          supplyStreetNumber: true,
          supplyCity: true,
          supplyProvince: true,
          supplyRegion: true,
          supplyZipCode: true,
          addressesMatch: true,
          notes: true,
        },
      },
    },
  });

  let updated = 0;
  let split = 0;
  let skipped = 0;
  let noMatch = 0;

  for (const c of contracts) {
    const pod = normalizePodKey(c.podPdr || c.pod || c.pdr);
    if (!pod) {
      noMatch++;
      continue;
    }
    const fromFile = byPod.get(pod);
    if (!fromFile) continue;

    const client = c.client;
    if (client.type !== "PRIVATO") continue;
    if (!needsNameFix(client.firstName, client.lastName)) {
      skipped++;
      continue;
    }
    if (!fromFile.firstName && !fromFile.lastName) continue;

    const before = clientDisplayName(client);
    const data = {
      lastName: fromFile.lastName,
      firstName: fromFile.firstName,
    };

    const otherCount = await prisma.contract.count({
      where: {
        clientId: client.id,
        id: { not: c.id },
        deletedAt: null,
      },
    });

    if (otherCount > 0) {
      const created = await prisma.client.create({
        data: {
          type: client.type,
          ...data,
          companyName: client.companyName,
          fiscalCode: client.fiscalCode,
          vatNumber: client.vatNumber,
          email: client.email,
          pec: client.pec,
          phone: client.phone,
          iban: client.iban,
          address: client.address,
          street: client.street,
          streetNumber: client.streetNumber,
          city: client.city,
          province: client.province,
          region: client.region,
          zipCode: client.zipCode,
          country: client.country,
          classification: client.classification,
          legalFirstName: client.legalFirstName,
          legalLastName: client.legalLastName,
          legalFiscalCode: client.legalFiscalCode,
          sdiCode: client.sdiCode,
          supplyAddress: client.supplyAddress,
          supplyStreet: client.supplyStreet,
          supplyStreetNumber: client.supplyStreetNumber,
          supplyCity: client.supplyCity,
          supplyProvince: client.supplyProvince,
          supplyRegion: client.supplyRegion,
          supplyZipCode: client.supplyZipCode,
          addressesMatch: client.addressesMatch,
          notes: client.notes,
          createdById: admin.id,
        },
      });
      await prisma.contract.update({
        where: { id: c.id },
        data: { clientId: created.id },
      });
      split++;
      if (split <= 8) {
        console.log(`  split ${pod}: «${before}» → ${data.lastName} ${data.firstName ?? ""}`);
      }
    } else {
      await prisma.client.update({
        where: { id: client.id },
        data,
      });
      updated++;
      if (updated <= 8) {
        console.log(`  ok ${pod}: «${before}» → ${data.lastName} ${data.firstName ?? ""}`);
      }
    }
  }

  console.log("\n=== RISULTATO ===");
  console.log({
    aggiornati: updated,
    anagraficaSeparata: split,
    giaCompleti: skipped,
    senzaPod: noMatch,
    totaleFix: updated + split,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
