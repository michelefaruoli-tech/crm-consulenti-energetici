/**
 * Sincronizza UTENZE APRILE 2026.xlsx → contratti Michele Faruoli.
 * Aggiorna POD, nome/cognome, fornitore, date pagamento (PROV).
 *
 * Uso: npx tsx scripts/sync-utenze-aprile-michele.ts [file.xlsx]
 */
import "dotenv/config";
import path from "node:path";
import ExcelJS from "exceljs";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import { computeSupplyStartDate } from "../src/lib/supply-dates";
import { clientDisplayName } from "../src/lib/utils";
import { normalizePodKey } from "../src/lib/storno-status";
import { normalizePersonKey } from "../src/lib/helios-provvigioni-shared";
import {
  isRecurring,
  monthsBetween,
  normalizeRecurrence,
  toPeriod,
} from "../src/lib/recurring";

const DEFAULT_FILE = "c:\\Users\\miche\\Desktop\\UTENZE APRILE 2026.xlsx";
const MICHELE_EMAIL = "michele.faruoli@gmail.com";
const AMOUNT_PRIVATO = 4;
const AMOUNT_AZIENDA = 6;

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

type ExcelRow = {
  excelRow: number;
  cognome: string;
  nome: string;
  telefono: string;
  pod: string;
  fornitore: string;
  utenza: string;
  prov: Date | null;
  dataA: Date | null;
  dataR: Date | null;
  agenzia: string;
  note: string;
};

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
  if (x instanceof Date && !Number.isNaN(x.getTime())) {
    return new Date(x.getFullYear(), x.getMonth(), x.getDate());
  }
  if (typeof x === "number" && x > 20000 && x < 80000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setUTCDate(epoch.getUTCDate() + Math.floor(x));
    return new Date(epoch.getUTCFullYear(), epoch.getUTCMonth(), epoch.getUTCDate());
  }
  const s = asString(x);
  if (!s || /^(ok|ko)$/i.test(s.trim())) return null;
  if (/[a-zA-Z]{2,}/.test(s) && !/^\d{4}-\d{2}/.test(s)) return null;
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

function isValidPodPdr(raw: string): boolean {
  const v = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!v) return false;
  const brands = [
    "TIM", "VODAFONE", "ENEL", "FIBRA", "WIND", "FASTWEB", "LINKEM", "EOLO", "SKY",
  ];
  if (brands.includes(v)) return false;
  if (/^IT\d{3}E[A-Z0-9]+$/i.test(v)) return true;
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
    SFERA: "Sfera",
    AXPO: "Axpo",
  };
  return map[u] ?? (name.trim() || "Sconosciuto");
}

function isBusinessRow(row: ExcelRow): boolean {
  const u = row.utenza.toUpperCase();
  if (u.includes("BUSINESS") || u.includes("AZIENDA")) return true;
  const label = `${row.cognome} ${row.nome}`.toUpperCase();
  return /\b(SRL|S\.R\.L\.|SNC|SAS|SPA|S\.P\.A\.|CONDOMINIO|SOCIETA|SOCIETÀ)\b/.test(
    label,
  );
}

async function allocateContractNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await prisma.$queryRaw<Array<{ last: number }>>`
    INSERT INTO "ContractNumberSequence" ("year", "last")
    VALUES (${year}, 1)
    ON CONFLICT ("year")
    DO UPDATE SET "last" = "ContractNumberSequence"."last" + 1
    RETURNING "last"
  `;
  return `CTR-${year}-${String(Number(rows[0]?.last ?? 1)).padStart(6, "0")}`;
}

async function getSupplierId(name: string): Promise<string> {
  let s = await prisma.supplier.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (s) return s.id;
  const code =
    name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 28) ||
    "SUP";
  s = await prisma.supplier.create({
    data: { name, code: `${code}_${Date.now().toString(36).slice(-4)}` },
    select: { id: true },
  });
  return s.id;
}

async function syncMonthsInline(contractId: string, expected: number): Promise<void> {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: {
      recurrence: true,
      supplyStartDate: true,
      insertionDate: true,
      operationType: true,
      status: true,
    },
  });
  if (!contract || !isRecurring(normalizeRecurrence(contract.recurrence))) return;

  const start = toPeriod(
    contract.supplyStartDate ??
      computeSupplyStartDate(contract.insertionDate, contract.operationType),
  );
  const now = toPeriod(new Date());
  for (const period of monthsBetween(start, now)) {
    const existing = await prisma.recurringMonth.findUnique({
      where: { contractId_period: { contractId, period } },
    });
    if (
      existing &&
      ["PAID", "CLOSED", "ERROR_UNPAID"].includes(existing.status)
    ) {
      continue;
    }
    const status = period < now ? "MISSING" : "PENDING";
    if (existing) {
      await prisma.recurringMonth.update({
        where: { id: existing.id },
        data: { status, amount: expected },
      });
    } else {
      await prisma.recurringMonth.create({
        data: { contractId, period, status, amount: expected },
      });
    }
  }
}

async function markHeliosPaidMonth(
  contractId: string,
  prov: Date,
  amount: number,
): Promise<void> {
  const period = `${prov.getFullYear()}-${String(prov.getMonth() + 1).padStart(2, "0")}`;
  const existing = await prisma.recurringMonth.findUnique({
    where: { contractId_period: { contractId, period } },
  });
  if (existing?.status === "PAID") return;
  if (existing) {
    await prisma.recurringMonth.update({
      where: { id: existing.id },
      data: {
        status: "PAID",
        paidAt: prov,
        settledPeriod: period,
        amount,
        note: existing.note ?? "Da UTENZE APRILE 2026",
      },
    });
  } else {
    await prisma.recurringMonth.create({
      data: {
        contractId,
        period,
        status: "PAID",
        paidAt: prov,
        settledPeriod: period,
        amount,
        note: "Da UTENZE APRILE 2026",
      },
    });
  }
}

async function updateClientForContract(
  contractId: string,
  clientId: string,
  row: ExcelRow,
  adminId: string,
): Promise<void> {
  const isAzienda = isBusinessRow(row);
  const clientData = isAzienda
    ? {
        type: "AZIENDA" as const,
        companyName: `${row.cognome} ${row.nome}`.trim(),
        firstName: null,
        lastName: null,
      }
    : {
        type: "PRIVATO" as const,
        lastName: row.cognome,
        firstName: row.nome,
        companyName: null,
      };

  const existing = await prisma.client.findUnique({ where: { id: clientId } });
  if (!existing) return;

  const otherCount = await prisma.contract.count({
    where: { clientId, id: { not: contractId }, deletedAt: null },
  });

  if (otherCount > 0) {
    const created = await prisma.client.create({
      data: {
        ...clientData,
        phone: row.telefono || existing.phone,
        createdById: adminId,
      },
    });
    await prisma.contract.update({
      where: { id: contractId },
      data: { clientId: created.id },
    });
    return;
  }

  await prisma.client.update({
    where: { id: clientId },
    data: {
      ...clientData,
      phone: row.telefono || existing.phone,
    },
  });
}

async function loadExcel(filePath: string): Promise<ExcelRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.resolve(filePath));
  const sheet =
    wb.worksheets.find((s) => s.name.toUpperCase() === "UTENZE") ??
    wb.worksheets[0]!;
  const col = {
    cognome: 2,
    nome: 3,
    telefono: 4,
    pod: 5,
    dataA: 7,
    dataR: 8,
    utenza: 9,
    fornitore: 10,
    prov: 12,
    agenzia: 13,
    note: 15,
  };
  const out: ExcelRow[] = [];
  for (let r = 5; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (!row.hasValues) continue;
    const cognome = asString(row.getCell(col.cognome).value).toUpperCase();
    const nome = asString(row.getCell(col.nome).value).toUpperCase();
    if (!cognome && !nome) continue;
    const podRaw = asString(row.getCell(col.pod).value);
    if (!isValidPodPdr(podRaw)) continue;
    const fornitoreRaw = asString(row.getCell(col.fornitore).value);
    if (!fornitoreRaw) continue;

    out.push({
      excelRow: r,
      cognome,
      nome,
      telefono: asString(row.getCell(col.telefono).value),
      pod: normalizePodKey(podRaw),
      fornitore: normalizeSupplier(fornitoreRaw),
      utenza: asString(row.getCell(col.utenza).value),
      prov: parseExcelDate(row.getCell(col.prov).value),
      dataA: parseExcelDate(row.getCell(col.dataA).value),
      dataR: parseExcelDate(row.getCell(col.dataR).value),
      agenzia: asString(row.getCell(col.agenzia).value),
      note: asString(row.getCell(col.note).value),
    });
  }
  return out;
}

async function findContract(
  micheleId: string,
  row: ExcelRow,
): Promise<{ id: string; clientId: string } | null> {
  const externalId = `utenze-apr2026-${row.pod}`.slice(0, 80);

  const byExternal = await prisma.contract.findFirst({
    where: { externalId, deletedAt: null },
    select: { id: true, clientId: true },
  });
  if (byExternal) return byExternal;

  const byPod = await prisma.contract.findFirst({
    where: {
      deletedAt: null,
      isHistorical: false,
      OR: [{ podPdr: row.pod }, { pod: row.pod }],
    },
    select: { id: true, clientId: true },
    orderBy: { updatedAt: "desc" },
  });
  if (byPod) return { id: byPod.id, clientId: byPod.clientId };

  const nameKey = normalizePersonKey(`${row.cognome} ${row.nome}`);
  const supplierId = await getSupplierId(row.fornitore);
  const candidates = await prisma.contract.findMany({
    where: {
      collaboratorId: micheleId,
      deletedAt: null,
      isHistorical: false,
      supplierId,
      OR: [{ podPdr: null }, { podPdr: "" }, { pod: null }, { pod: "" }],
    },
    select: {
      id: true,
      clientId: true,
      client: {
        select: {
          firstName: true,
          lastName: true,
          companyName: true,
          type: true,
        },
      },
    },
  });
  const match = candidates.find(
    (c) => normalizePersonKey(clientDisplayName(c.client)) === nameKey,
  );
  if (match) return { id: match.id, clientId: match.clientId };
  return null;
}

async function applyRow(
  contractId: string,
  clientId: string,
  row: ExcelRow,
  micheleId: string,
  adminId: string,
): Promise<void> {
  const supplierId = await getSupplierId(row.fornitore);
  const isHelios = row.fornitore.toLowerCase() === "helios";
  const isAzienda = isBusinessRow(row);
  const expected = isAzienda ? AMOUNT_AZIENDA : AMOUNT_PRIVATO;

  const insertionDate =
    row.dataA ?? row.dataR ?? new Date();
  const supplyStartDate =
    row.dataR ??
    computeSupplyStartDate(insertionDate, "CAMBIO");

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { status: true, collectionDate: true },
  });

  const paid = Boolean(row.prov);
  const contractUpdate: Record<string, unknown> = {
    collaboratorId: micheleId,
    supplierId,
    podPdr: row.pod,
    pod: row.pod,
    utilityType: row.pod.startsWith("IT") ? "Luce" : "Gas",
    insertionDate,
    supplyStartDate,
    agency: row.agenzia || null,
    recurrence: isHelios ? "Ricorrente" : undefined,
  };

  if (paid && row.prov) {
    contractUpdate.paymentStatus = "Incassato";
    contractUpdate.collectionDate = row.prov;
    if (contract?.status !== "PROVVIGIONE_LIQUIDATA") {
      contractUpdate.status = "PAGATO_DAL_FORNITORE";
    }
    contractUpdate.commissionConfirmed = true;
    contractUpdate.commissionConfirmedAt = row.prov;
  }

  await prisma.contract.update({
    where: { id: contractId },
    data: contractUpdate,
  });

  await updateClientForContract(contractId, clientId, row, adminId);

  const existingCommission = await prisma.commission.findUnique({
    where: { contractId },
  });
  if (existingCommission) {
    if (isHelios) {
      await prisma.commission.update({
        where: { contractId },
        data: { expected },
      });
    }
  } else {
    await prisma.commission.create({
      data: {
        contractId,
        expected: isHelios ? expected : 0,
        received: 0,
        paid: 0,
        accrued: 0,
      },
    });
  }

  if (isHelios) {
    if (row.prov) await markHeliosPaidMonth(contractId, row.prov, expected);
    await syncMonthsInline(contractId, expected);
  }
}

async function createContract(
  row: ExcelRow,
  micheleId: string,
  adminId: string,
): Promise<void> {
  const externalId = `utenze-apr2026-${row.pod}`.slice(0, 80);
  const existing = await prisma.contract.findFirst({
    where: { externalId },
    select: { id: true, clientId: true },
  });
  if (existing) {
    await applyRow(existing.id, existing.clientId, row, micheleId, adminId);
    return;
  }

  const isAzienda = isBusinessRow(row);
  const isHelios = row.fornitore.toLowerCase() === "helios";
  const expected = isAzienda ? AMOUNT_AZIENDA : AMOUNT_PRIVATO;
  const supplierId = await getSupplierId(row.fornitore);

  const client = await prisma.client.create({
    data: {
      type: isAzienda ? "AZIENDA" : "PRIVATO",
      lastName: isAzienda ? null : row.cognome,
      firstName: isAzienda ? null : row.nome,
      companyName: isAzienda ? `${row.cognome} ${row.nome}`.trim() : null,
      phone: row.telefono || null,
      createdById: adminId,
      notes: row.note || null,
    },
  });

  const insertionDate = row.dataA ?? row.dataR ?? new Date();
  const supplyStartDate =
    row.dataR ?? computeSupplyStartDate(insertionDate, "CAMBIO");
  const paid = Boolean(row.prov);
  const contractNumber = await allocateContractNumber();

  const contract = await prisma.contract.create({
    data: {
      contractNumber,
      externalId: `utenze-apr2026-${row.pod}`.slice(0, 80),
      clientId: client.id,
      collaboratorId: micheleId,
      createdById: adminId,
      supplierId,
      status: paid ? "PAGATO_DAL_FORNITORE" : "ATTIVATO",
      utilityType: row.pod.startsWith("IT") ? "Luce" : "Gas",
      podPdr: row.pod,
      pod: row.pod,
      recurrence: isHelios ? "Ricorrente" : "Una tantum",
      operationType: "CAMBIO",
      insertionDate,
      supplyStartDate,
      paymentStatus: paid ? "Incassato" : "Da incassare",
      collectionDate: row.prov,
      commissionConfirmed: paid,
      commissionConfirmedAt: paid ? row.prov : null,
      agency: row.agenzia || null,
      isHistorical: false,
      notes: ["UTENZE APRILE 2026", row.note].filter(Boolean).join(" · "),
    },
  });

  await prisma.commission.create({
    data: {
      contractId: contract.id,
      expected: isHelios ? expected : 0,
      received: 0,
      paid: 0,
      accrued: 0,
    },
  });

  if (isHelios) {
    if (row.prov) await markHeliosPaidMonth(contract.id, row.prov, expected);
    await syncMonthsInline(contract.id, expected);
  }
}

async function main() {
  const filePath = process.argv[2] ?? DEFAULT_FILE;
  const michele = await prisma.user.findUnique({
    where: { email: MICHELE_EMAIL },
    select: { id: true, name: true },
  });
  if (!michele) throw new Error(`Utente ${MICHELE_EMAIL} non trovato`);

  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!admin) throw new Error("Admin non trovato");

  const rows = await loadExcel(filePath);
  console.log("File:", filePath);
  console.log("Righe energy (POD valido):", rows.length);
  console.log("Collaboratore:", michele.name);

  let updated = 0;
  let created = 0;
  let skipped = 0;

  for (const row of rows) {
    const hit = await findContract(michele.id, row);
    if (hit) {
      await applyRow(hit.id, hit.clientId, row, michele.id, admin.id);
      updated++;
      if (updated <= 5 || updated % 50 === 0) {
        console.log(`✓ aggiornato ${row.cognome} ${row.nome} | ${row.pod}`);
      }
    } else {
      await createContract(row, michele.id, admin.id);
      created++;
      console.log(`+ creato ${row.cognome} ${row.nome} | ${row.pod}`);
    }
  }

  console.log("\n=== RISULTATO ===");
  console.log({ aggiornati: updated, creati: created, saltati: skipped });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
