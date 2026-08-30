/**
 * Allinea Helios da TUTTI i rendiconti:
 * - nome/cognome corretti da «Intestatario» (una anagrafica per contratto, no cloni)
 * - data ingresso fornitura da colonna «Inizio»
 * - mesi PAID per ogni presenza nei file
 * - se presente a giugno → dall'ingresso fino a giugno tutto PAID
 * - se sparisce da un rendiconto successivo → mese ERROR_UNPAID + nota ASSENTE_RENDICONTO
 *
 * Uso:
 *   npx tsx scripts/sync-helios-all-rendiconti.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import { normalizePodKey } from "../src/lib/storno-status";
import { parsePrivatoDisplayName } from "../src/lib/utils";
import {
  guessCompetenceFromFilename,
  periodFromSheetName,
  canMarkIncassatoForCompetencePeriod,
} from "../src/lib/helios-provvigioni-shared";
import {
  monthsBetween,
  toPeriod,
} from "../src/lib/recurring";

const DIR = "c:\\Users\\miche\\OneDrive\\utenze\\Inviti Helios";
const FILES = [
  "Provvigioni_Dicembre_2025_a_Febbraio_2026_AG_MELFI_PZ4 - FARUOLI MICHELE.xlsx",
  "Provvigioni_Marzo_2026_AG_MELFI_PZ4 - FARUOLI MICHELE.xlsx",
  "Provvigioni_Aprile_2026_AG_MELFI_PZ4 - FARUOLI MICHELE.xlsx",
  "Provvigioni_Maggio_2026_AG_MELFI_PZ4 - FARUOLI MICHELE.xlsx",
  "Provvigioni_Giugno_2026_AG_MELFI_PZ4 - FARUOLI MICHELE.xlsx",
  "Provvigioni_Luglio_2026_AG_MELFI_PZ4 - FARUOLI MICHELE.xlsx",
];

const AMOUNT_PRIVATO = 4;
const AMOUNT_AZIENDA = 6;
const ABSENT_NOTE = "ASSENTE_RENDICONTO";

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

type HeliosPresence = {
  pod: string;
  intestatario: string;
  baseAmount: number;
  supplyStart: Date | null;
  periods: Set<string>;
  utilizzo: string;
};

function cellStr(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const o = value as {
      text?: unknown;
      result?: unknown;
      richText?: Array<{ text?: string }>;
    };
    if (Array.isArray(o.richText)) {
      return o.richText.map((t) => t.text ?? "").join("");
    }
    if (o.text != null) return cellStr(o.text);
    if (o.result != null) return cellStr(o.result);
  }
  return String(value).trim();
}

function cellNum(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = cellStr(value).replace(",", ".").replace(/[^\d.-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function cellDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setUTCDate(epoch.getUTCDate() + Math.floor(value));
    return new Date(
      epoch.getUTCFullYear(),
      epoch.getUTCMonth(),
      epoch.getUTCDate(),
    );
  }
  const s = cellStr(value);
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(+iso[1]!, +iso[2]! - 1, +iso[3]!);
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (dmy) return new Date(+dmy[3]!, +dmy[2]! - 1, +dmy[1]!);
  return null;
}

function headerIndex(
  headers: Array<string | undefined>,
  ...names: string[]
): number {
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

function isAzienda(intestatario: string, utilizzo: string): boolean {
  const u = utilizzo.toUpperCase();
  if (u.includes("ALTRI") || u.includes("BUSINESS")) return true;
  return /\b(SRL|S\.R\.L\.|SNC|SAS|SPA|S\.P\.A\.|SRLS|APS|ASD|SS|CONDOMINIO|COOPERATIVA)\b/i.test(
    intestatario,
  );
}

function parseClientFields(
  intestatario: string,
  utilizzo: string,
  _amount: number,
): {
  type: "PRIVATO" | "AZIENDA";
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
} {
  const raw = intestatario.trim().replace(/\s+/g, " ").toUpperCase();
  if (isAzienda(raw, utilizzo)) {
    return {
      type: "AZIENDA",
      companyName: raw,
      firstName: null,
      lastName: null,
    };
  }
  const parsed = parsePrivatoDisplayName(raw);
  return {
    type: "PRIVATO",
    lastName: parsed.lastName.toUpperCase(),
    firstName: parsed.firstName ? parsed.firstName.toUpperCase() : null,
    companyName: null,
  };
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

async function loadAllFiles(): Promise<{
  byPod: Map<string, HeliosPresence>;
  allPeriods: string[];
}> {
  const byPod = new Map<string, HeliosPresence>();
  const periodSet = new Set<string>();

  for (const fileName of FILES) {
    const filePath = path.join(DIR, fileName);
    if (!fs.existsSync(filePath)) {
      console.warn("File mancante:", fileName);
      continue;
    }
    const fallback =
      guessCompetenceFromFilename(fileName) ?? "2026-06";
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);

    for (const sheet of wb.worksheets) {
      if (/riepilogo/i.test(sheet.name)) continue;
      const headers: Array<string | undefined> = [];
      sheet.getRow(1).eachCell((c, col) => {
        headers[col] = cellStr(c.value).toLowerCase();
      });
      const colPod = headerIndex(
        headers,
        "cod.ute.",
        "cod.ute",
        "cod ute",
        "pod",
        "pdr",
      );
      if (colPod < 0) continue;

      const colName = headerIndex(
        headers,
        "intestatario contratto",
        "intestatario",
      );
      const colInizio = headerIndex(headers, "inizio");
      const colUtilizzo = headerIndex(headers, "utilizzo");
      const colBase = headerIndex(
        headers,
        "provvigione base (regola 1)",
        "provvigione base",
        "provvigione",
      );

      const sheetPeriod = periodFromSheetName(sheet.name) ?? fallback;
      periodSet.add(sheetPeriod);

      for (let r = 2; r <= sheet.rowCount; r++) {
        const row = sheet.getRow(r);
        if (!row.hasValues) continue;
        const pod = normalizePodKey(cellStr(row.getCell(colPod).value));
        if (!isValidPod(pod)) continue;
        const intestatario =
          colName >= 0 ? cellStr(row.getCell(colName).value) : "";
        const supplyStart =
          colInizio >= 0 ? cellDate(row.getCell(colInizio).value) : null;
        const utilizzo =
          colUtilizzo >= 0 ? cellStr(row.getCell(colUtilizzo).value) : "";
        const baseAmount =
          colBase >= 0 ? cellNum(row.getCell(colBase).value) : 0;

        const existing = byPod.get(pod);
        if (existing) {
          existing.periods.add(sheetPeriod);
          if (!existing.intestatario && intestatario) {
            existing.intestatario = intestatario;
          }
          if (!existing.supplyStart && supplyStart) {
            existing.supplyStart = supplyStart;
          }
          if (baseAmount > 0) existing.baseAmount = baseAmount;
          if (utilizzo) existing.utilizzo = utilizzo;
        } else {
          byPod.set(pod, {
            pod,
            intestatario,
            baseAmount,
            supplyStart,
            periods: new Set([sheetPeriod]),
            utilizzo,
          });
        }
      }
    }
    console.log("Letto:", fileName);
  }

  return { byPod, allPeriods: [...periodSet].sort() };
}

async function ensureDedicatedClient(
  contractId: string,
  clientId: string,
  fields: ReturnType<typeof parseClientFields>,
  adminId: string,
  phone?: string | null,
): Promise<string> {
  const otherCount = await prisma.contract.count({
    where: { clientId, id: { not: contractId }, deletedAt: null },
  });

  if (otherCount > 0) {
    const created = await prisma.client.create({
      data: {
        type: fields.type,
        firstName: fields.firstName,
        lastName: fields.lastName,
        companyName: fields.companyName,
        phone: phone ?? null,
        createdById: adminId,
        notes: "Anagrafica dedicata (sync Helios — no clone)",
      },
    });
    await prisma.contract.update({
      where: { id: contractId },
      data: { clientId: created.id },
    });
    return created.id;
  }

  await prisma.client.update({
    where: { id: clientId },
    data: {
      type: fields.type,
      firstName: fields.firstName,
      lastName: fields.lastName,
      companyName: fields.companyName,
    },
  });
  return clientId;
}

async function upsertMonth(
  contractId: string,
  period: string,
  status: "PAID" | "ERROR_UNPAID",
  amount: number,
  note?: string,
): Promise<void> {
  const existing = await prisma.recurringMonth.findUnique({
    where: { contractId_period: { contractId, period } },
  });

  if (status === "PAID") {
    if (existing?.status === "PAID") {
      if (amount && existing.amount == null) {
        await prisma.recurringMonth.update({
          where: { id: existing.id },
          data: { amount },
        });
      }
      return;
    }
    if (existing) {
      await prisma.recurringMonth.update({
        where: { id: existing.id },
        data: {
          status: "PAID",
          paidAt: new Date(),
          settledPeriod: period,
          amount: amount || existing.amount,
          note: existing.note?.includes(ABSENT_NOTE)
            ? `Incassato (era assente rendiconto)`
            : existing.note ?? "Sync rendiconto Helios",
        },
      });
    } else {
      await prisma.recurringMonth.create({
        data: {
          contractId,
          period,
          status: "PAID",
          paidAt: new Date(),
          settledPeriod: period,
          amount,
          note: "Sync rendiconto Helios",
        },
      });
    }
    return;
  }

  // ERROR_UNPAID (assente)
  if (existing?.status === "PAID") return; // già pagato: non degradare
  if (existing?.status === "CLOSED") return;
  const fullNote = `${ABSENT_NOTE}: non compare nel rendiconto ${period} — verifica se cessato o errore Helios`;
  if (existing) {
    await prisma.recurringMonth.update({
      where: { id: existing.id },
      data: {
        status: "ERROR_UNPAID",
        amount: amount || existing.amount,
        note: fullNote,
      },
    });
  } else {
    await prisma.recurringMonth.create({
      data: {
        contractId,
        period,
        status: "ERROR_UNPAID",
        amount,
        note: fullNote,
      },
    });
  }
}

async function main() {
  const helios = await prisma.supplier.findFirst({
    where: { name: { equals: "Helios", mode: "insensitive" } },
  });
  if (!helios) throw new Error("Fornitore Helios non trovato");

  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", active: true },
    orderBy: { createdAt: "asc" },
  });
  if (!admin) throw new Error("Admin non trovato");

  const michele = await prisma.user.findUnique({
    where: { email: "michele.faruoli@gmail.com" },
  });

  const { byPod, allPeriods } = await loadAllFiles();
  const latestPeriod = allPeriods[allPeriods.length - 1]!;
  console.log("Periodi rendiconto:", allPeriods.join(", "));
  console.log("POD unici:", byPod.size, "| ultimo mese:", latestPeriod);

  let updated = 0;
  let created = 0;
  let namesFixed = 0;
  let split = 0;
  let absentAlerts = 0;

  for (const entry of byPod.values()) {
    const fields = parseClientFields(
      entry.intestatario,
      entry.utilizzo,
      entry.baseAmount,
    );
    const expected =
      fields.type === "AZIENDA" ? AMOUNT_AZIENDA : AMOUNT_PRIVATO;
    const amount = entry.baseAmount > 0 ? entry.baseAmount : expected;

    let contract = await prisma.contract.findFirst({
      where: {
        deletedAt: null,
        isHistorical: false,
        OR: [{ podPdr: entry.pod }, { pod: entry.pod }],
        supplierId: helios.id,
      },
      select: {
        id: true,
        clientId: true,
        collaboratorId: true,
        supplyStartDate: true,
        client: { select: { phone: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    // fallback: stesso POD anche se fornitore sbagliato
    if (!contract) {
      contract = await prisma.contract.findFirst({
        where: {
          deletedAt: null,
          isHistorical: false,
          OR: [{ podPdr: entry.pod }, { pod: entry.pod }],
        },
        select: {
          id: true,
          clientId: true,
          collaboratorId: true,
          supplyStartDate: true,
          client: { select: { phone: true } },
        },
        orderBy: { updatedAt: "desc" },
      });
      if (contract) {
        await prisma.contract.update({
          where: { id: contract.id },
          data: { supplierId: helios.id, recurrence: "Ricorrente" },
        });
      }
    }

    const supplyStart =
      entry.supplyStart ??
      contract?.supplyStartDate ??
      new Date(2026, 0, 1);
    const supplyStartedByLatest = canMarkIncassatoForCompetencePeriod(
      supplyStart,
      latestPeriod,
    );

    if (!contract) {
      const client = await prisma.client.create({
        data: {
          type: fields.type,
          firstName: fields.firstName,
          lastName: fields.lastName,
          companyName: fields.companyName,
          createdById: admin.id,
          notes: "Creato da sync Helios rendiconti",
        },
      });
      const cn = await allocateContractNumber();
      const createdC = await prisma.contract.create({
        data: {
          contractNumber: cn,
          externalId: `helios-sync-${entry.pod}`.slice(0, 80),
          clientId: client.id,
          collaboratorId: michele?.id ?? admin.id,
          createdById: admin.id,
          supplierId: helios.id,
          utilityType: "Luce",
          podPdr: entry.pod,
          pod: entry.pod,
          recurrence: "Ricorrente",
          operationType: "CAMBIO",
          insertionDate: supplyStart,
          supplyStartDate: supplyStart,
          paymentStatus: supplyStartedByLatest ? "Incassato" : "Da incassare",
          ...(supplyStartedByLatest
            ? {
                status: "PAGATO_DAL_FORNITORE",
                collectionDate: new Date(
                  +latestPeriod.slice(0, 4),
                  +latestPeriod.slice(5, 7) - 1,
                  1,
                ),
              }
            : {
                status: "IN_ATTESA_PAGAMENTO",
                collectionDate: null,
              }),
          isHistorical: false,
          notes: "Helios ricorrente — sync rendiconti",
        },
      });
      await prisma.commission.create({
        data: {
          contractId: createdC.id,
          expected,
          received: 0,
          paid: 0,
          accrued: 0,
        },
      });
      contract = {
        id: createdC.id,
        clientId: client.id,
        collaboratorId: michele?.id ?? admin.id,
        supplyStartDate: supplyStart,
        client: { phone: null },
      };
      created++;
      console.log(`+ ${entry.intestatario} | ${entry.pod}`);
    } else {
      const beforeClient = contract.clientId;
      const newClientId = await ensureDedicatedClient(
        contract.id,
        contract.clientId,
        fields,
        admin.id,
        contract.client.phone,
      );
      if (newClientId !== beforeClient) split++;
      else namesFixed++;

      await prisma.contract.update({
        where: { id: contract.id },
        data: {
          supplierId: helios.id,
          podPdr: entry.pod,
          pod: entry.pod,
          recurrence: "Ricorrente",
          supplyStartDate: supplyStart,
          utilityType: "Luce",
          paymentStatus: supplyStartedByLatest ? "Incassato" : "Da incassare",
          status: supplyStartedByLatest
            ? "PAGATO_DAL_FORNITORE"
            : "IN_ATTESA_PAGAMENTO",
          collectionDate: supplyStartedByLatest
            ? new Date(
                +latestPeriod.slice(0, 4),
                +latestPeriod.slice(5, 7) - 1,
                1,
              )
            : null,
        },
      });

      const commission = await prisma.commission.findUnique({
        where: { contractId: contract.id },
      });
      if (commission) {
        await prisma.commission.update({
          where: { contractId: contract.id },
          data: { expected },
        });
      } else {
        await prisma.commission.create({
          data: {
            contractId: contract.id,
            expected,
            received: 0,
            paid: 0,
            accrued: 0,
          },
        });
      }
      updated++;
    }

    // Mesi: dall'ingresso fino all'ultimo rendiconto
    const startPeriod = toPeriod(supplyStart);
    const expectedPeriods = monthsBetween(startPeriod, latestPeriod);
    const present = entry.periods;
    const inLatest = present.has(latestPeriod);

    for (const period of expectedPeriods) {
      if (period < startPeriod) continue;
      if (!canMarkIncassatoForCompetencePeriod(supplyStart, period)) continue;

      if (present.has(period) || inLatest) {
        // Presente nel file, oppure nell'ultimo rendiconto ⇒ mesi in fornitura pagati
        await upsertMonth(contract.id, period, "PAID", amount);
      } else {
        // Era dovuto ma non compare in nessun file e non è in giugno
        // Solo se ha già avuto almeno un mese presente prima di questo
        const earlierPresent = [...present].some((p) => p < period);
        if (earlierPresent) {
          await upsertMonth(contract.id, period, "ERROR_UNPAID", amount);
          absentAlerts++;
        } else if (period < startPeriod) {
          // skip
        } else {
          // Non ancora mai apparso: MISSING generico se passato
          const existing = await prisma.recurringMonth.findUnique({
            where: {
              contractId_period: { contractId: contract.id, period },
            },
          });
          if (!existing) {
            await prisma.recurringMonth.create({
              data: {
                contractId: contract.id,
                period,
                status: period < latestPeriod ? "MISSING" : "PENDING",
                amount,
              },
            });
          }
        }
      }
    }

    if (updated % 40 === 0 && updated > 0) {
      console.log(`… aggiornati ${updated}/${byPod.size}`);
    }
  }

  console.log("\n=== RISULTATO ===");
  console.log({
    podUnici: byPod.size,
    aggiornati: updated,
    creati: created,
    nomiSistemati: namesFixed,
    anagraficheSeparate: split,
    alertAssenti: absentAlerts,
    periodi: allPeriods,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
