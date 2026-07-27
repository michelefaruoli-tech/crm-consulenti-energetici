/**
 * Allinea giugno 2026 Helios: POD mancanti, incasso, collaboratore Laforgia Vito.
 * Crea i contratti non presenti nel CRM.
 *
 * Uso: npx tsx scripts/fix-helios-giugno-laforgia.ts [file.xlsx]
 */
import "dotenv/config";
import fs from "fs";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import { parseHeliosProvvigioniBuffer } from "../src/lib/helios-provvigioni-parse";
import { normalizePersonKey } from "../src/lib/helios-provvigioni-shared";
import { clientDisplayName } from "../src/lib/utils";
import { normalizePodKey } from "../src/lib/storno-status";
import {
  isRecurring,
  monthsBetween,
  normalizeRecurrence,
  toPeriod,
} from "../src/lib/recurring";

const DEFAULT_FILE =
  "c:\\Users\\miche\\Downloads\\Provvigioni_Giugno_2026_AG_MELFI_PZ4 - FARUOLI MICHELE.xlsx";
const PERIOD = "2026-06";
const SETTLED = "2026-06";
const AMOUNT_PRIVATO = 4;
const AMOUNT_AZIENDA = 6;

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

async function allocateContractNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await prisma.$queryRaw<Array<{ last: number }>>`
    INSERT INTO "ContractNumberSequence" ("year", "last")
    VALUES (${year}, 1)
    ON CONFLICT ("year")
    DO UPDATE SET "last" = "ContractNumberSequence"."last" + 1
    RETURNING "last"
  `;
  const last = Number(rows[0]?.last ?? 1);
  return `CTR-${year}-${String(last).padStart(6, "0")}`;
}

function parseIntestatario(
  raw: string,
  amount: number,
): {
  type: "PRIVATO" | "AZIENDA";
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
} {
  const name = raw.trim().toUpperCase();
  const isAzienda =
    amount >= 6 ||
    /\b(SRL|S\.R\.L\.|SNC|SAS|SPA|S\.P\.A\.|S\.R\.L)\b/i.test(raw);
  if (isAzienda) {
    return {
      type: "AZIENDA",
      firstName: null,
      lastName: null,
      companyName: name,
    };
  }
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return { type: "PRIVATO", lastName: parts[0] ?? name, firstName: null };
  }
  return {
    type: "PRIVATO",
    lastName: parts[0]!,
    firstName: parts.slice(1).join(" "),
  };
}

async function syncMonthsInline(
  contractId: string,
  expectedAmount: number,
): Promise<void> {
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

  const start = toPeriod(contract.supplyStartDate ?? contract.insertionDate);
  const now = toPeriod(new Date());
  const periods = monthsBetween(start, now);

  for (const period of periods) {
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
        data: {
          contractId,
          period,
          status,
          amount: expectedAmount,
        },
      });
    }
  }
}

async function markJunePaid(
  contractId: string,
  amount: number,
): Promise<"created" | "updated" | "skipped"> {
  const existing = await prisma.recurringMonth.findUnique({
    where: { contractId_period: { contractId, period: PERIOD } },
  });
  if (existing?.status === "PAID") return "skipped";

  if (existing) {
    await prisma.recurringMonth.update({
      where: { id: existing.id },
      data: {
        status: "PAID",
        paidAt: new Date(),
        settledPeriod: SETTLED,
        amount: amount ?? existing.amount,
        note: existing.note ?? "Import rendiconto Helios giugno 2026 (Laforgia)",
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
        note: "Import rendiconto Helios giugno 2026 (Laforgia)",
      },
    });
  }

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { status: true },
  });
  const [y, mo] = PERIOD.split("-").map(Number);
  await prisma.contract.update({
    where: { id: contractId },
    data: {
      ...(contract?.status === "PROVVIGIONE_LIQUIDATA"
        ? {}
        : { status: "PAGATO_DAL_FORNITORE" }),
      paymentStatus: "Incassato",
      collectionDate: new Date(y!, mo! - 1, 1),
      recurrence: "Ricorrente",
    },
  });
  return existing ? "updated" : "created";
}

type ContractHit = {
  id: string;
  podPdr: string | null;
  pod: string | null;
};

async function findContract(
  heliosId: string,
  pod: string,
  intestatario: string,
): Promise<ContractHit | null> {
  const byPod = await prisma.contract.findFirst({
    where: {
      supplierId: heliosId,
      deletedAt: null,
      isHistorical: false,
      OR: [{ podPdr: pod }, { pod }, { pdr: pod }],
    },
    select: { id: true, podPdr: true, pod: true },
  });
  if (byPod) return byPod;

  const nameKey = normalizePersonKey(intestatario);
  if (!nameKey) return null;

  const candidates = await prisma.contract.findMany({
    where: {
      supplierId: heliosId,
      deletedAt: null,
      isHistorical: false,
    },
    select: {
      id: true,
      podPdr: true,
      pod: true,
      client: {
        select: {
          type: true,
          firstName: true,
          lastName: true,
          companyName: true,
        },
      },
    },
  });

  const matches = candidates.filter(
    (c) => normalizePersonKey(clientDisplayName(c.client)) === nameKey,
  );
  if (matches.length === 0) {
    // match parziale: cognome/azienda
    const partial = candidates.filter((c) => {
      const dn = clientDisplayName(c.client).toUpperCase();
      const parts = intestatario.toUpperCase().split(/\s+/);
      return parts.some((p) => p.length > 3 && dn.includes(p));
    });
    if (partial.length === 1) return partial[0]!;
    // preferisci senza POD
    const noPod = partial.filter(
      (c) => !normalizePodKey(c.podPdr || c.pod),
    );
    if (noPod.length === 1) return noPod[0]!;
    if (partial.length > 0) return partial[0]!;
    return null;
  }

  const noPod = matches.filter((c) => !normalizePodKey(c.podPdr || c.pod));
  if (noPod.length >= 1) return noPod[0]!;
  return matches[0]!;
}

async function main() {
  const filePath = process.argv[2] ?? DEFAULT_FILE;
  if (!fs.existsSync(filePath)) throw new Error(`File non trovato: ${filePath}`);

  const laforgia = await prisma.user.findFirst({
    where: { name: { equals: "Laforgia Vito", mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!laforgia) throw new Error("Collaboratore Laforgia Vito non trovato");

  const helios = await prisma.supplier.findFirst({
    where: { name: { equals: "Helios", mode: "insensitive" } },
    select: { id: true },
  });
  if (!helios) throw new Error("Fornitore Helios non trovato");

  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!admin) throw new Error("Admin non trovato per createdById");

  const buffer = fs.readFileSync(filePath);
  const parsed = await parseHeliosProvvigioniBuffer(buffer, PERIOD);
  if (!parsed.ok) throw new Error(parsed.error);

  const lines = parsed.lines.filter((l) => l.competencePeriod === PERIOD);
  console.log("Righe giugno nel file:", lines.length);

  // POD da sistemare (mancanti nel conteggio incassati)
  const targetPods = new Set([
    "IT001E71921483",
    "IT001E89314477",
    "IT001E89235936",
    "IT001E65720310",
    "IT001E89292022",
    "IT001E76562047",
    "IT001E89761624",
    "IT001E11522518",
    "IT001E74735660",
    "IT001E11522504",
    "IT001E12611913",
    "IT001E72251161",
    "IT001E45731948",
    "IT001E13441025",
  ]);

  const toProcess = lines.filter((l) => targetPods.has(l.pod));
  console.log("Da elaborare:", toProcess.length);

  let created = 0;
  let updated = 0;
  let juneMarked = 0;
  let skipped = 0;

  const supplyStart = new Date(2026, 0, 1); // gen 2026 per generare mesi
  const insertionDate = new Date(2026, 5, 1);

  for (const line of toProcess) {
    const amount =
      line.baseAmount > 0
        ? line.baseAmount
        : clientData.type === "AZIENDA"
          ? AMOUNT_AZIENDA
          : AMOUNT_PRIVATO;
    const clientData = parseIntestatario(line.intestatario, amount);
    const expected =
      clientData.type === "AZIENDA" ? AMOUNT_AZIENDA : AMOUNT_PRIVATO;

    let contract = await findContract(
      helios.id,
      line.pod,
      line.intestatario,
    );

    if (contract) {
      const existingPod = normalizePodKey(contract.podPdr || contract.pod);
      if (existingPod && existingPod !== line.pod) {
        // Seconda utenza stesso cliente: nuovo contratto
        contract = null;
      }
    }

    if (contract) {
      await prisma.contract.update({
        where: { id: contract.id },
        data: {
          collaboratorId: laforgia.id,
          podPdr: line.pod,
          pod: line.pod,
          recurrence: "Ricorrente",
          utilityType: line.pod.startsWith("IT") ? "Luce" : "Gas",
        },
      });
      await prisma.commission.upsert({
        where: { contractId: contract.id },
        create: {
          contractId: contract.id,
          expected: expected,
          received: 0,
          paid: 0,
          accrued: 0,
        },
        update: { expected },
      });
      const j = await markJunePaid(contract.id, amount || expected);
      if (j !== "skipped") juneMarked++;
      else skipped++;
      await syncMonthsInline(contract.id, expected);
      updated++;
      console.log(`✓ aggiornato: ${line.intestatario} | ${line.pod}`);
      continue;
    }

    // Nuovo contratto
    const client = await prisma.client.create({
      data: {
        type: clientData.type,
        firstName: clientData.firstName,
        lastName: clientData.lastName,
        companyName: clientData.companyName,
        createdById: admin.id,
        notes: "Creato da rendiconto Helios giugno 2026",
      },
    });

    const contractNumber = await allocateContractNumber();
    const newContract = await prisma.contract.create({
      data: {
        contractNumber,
        externalId: `helios-giu2026-${line.pod}`.slice(0, 80),
        clientId: client.id,
        collaboratorId: laforgia.id,
        createdById: admin.id,
        supplierId: helios.id,
        status: "PAGATO_DAL_FORNITORE",
        utilityType: line.pod.startsWith("IT") ? "Luce" : "Gas",
        podPdr: line.pod,
        pod: line.pod,
        recurrence: "Ricorrente",
        operationType: "CAMBIO",
        insertionDate,
        supplyStartDate: supplyStart,
        paymentStatus: "Incassato",
        collectionDate: new Date(2026, 5, 1),
        isHistorical: false,
        notes: "Helios ricorrente — import giugno 2026 Laforgia",
      },
    });

    await prisma.commission.create({
      data: {
        contractId: newContract.id,
        expected,
        received: 0,
        paid: 0,
        accrued: 0,
      },
    });

    await markJunePaid(newContract.id, amount || expected);
    await syncMonthsInline(newContract.id, expected);
    juneMarked++;
    created++;
    console.log(`+ creato: ${line.intestatario} | ${line.pod}`);
  }

  // Verifica finale
  const contracts = await prisma.contract.findMany({
    where: { supplierId: helios.id, deletedAt: null, isHistorical: false },
    select: {
      podPdr: true,
      pod: true,
      pdr: true,
      recurringMonths: { where: { period: PERIOD, status: "PAID" } },
    },
  });
  const paidByPod = new Set<string>();
  for (const c of contracts) {
    if (c.recurringMonths.length === 0) continue;
    const pod = normalizePodKey(c.podPdr || c.pod || c.pdr);
    if (pod) paidByPod.add(pod);
  }
  let excelPaid = 0;
  for (const l of lines) {
    if (paidByPod.has(l.pod)) excelPaid++;
  }

  console.log("\n=== RISULTATO ===");
  console.log({
    collaboratore: laforgia.name,
    contrattiAggiornati: updated,
    contrattiCreati: created,
    giugnoSegnati: juneMarked,
    giaIncassati: skipped,
    excelMatchIncassati: `${excelPaid}/${lines.length}`,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
