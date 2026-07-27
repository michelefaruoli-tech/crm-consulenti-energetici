/**
 * Corregge POD assegnati per errore (match nome parziale) e crea i contratti giusti.
 */
import "dotenv/config";
import fs from "fs";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import { parseHeliosProvvigioniBuffer } from "../src/lib/helios-provvigioni-parse";
import { clientDisplayName } from "../src/lib/utils";

const FILE =
  "c:\\Users\\miche\\Downloads\\Provvigioni_Giugno_2026_AG_MELFI_PZ4 - FARUOLI MICHELE.xlsx";
const PERIOD = "2026-06";

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

/** POD → cliente Excel sbagliato assegnato nel CRM */
const WRONG: Array<{ pod: string; wrongName: string; restorePod?: string }> = [
  {
    pod: "IT001E11522504",
    wrongName: "MARTINO ALFONSO",
    restorePod: "IT001E84790596",
  },
  { pod: "IT001E11522518", wrongName: "MARCONE ANTONIETTA" },
  { pod: "IT001E72251161", wrongName: "NAPOLI GIOVANNI" },
  { pod: "IT001E13441025", wrongName: "SISTI GIUSEPPE" },
];

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

function parseName(raw: string, amount: number) {
  const name = raw.trim().toUpperCase();
  const isAzienda =
    amount >= 6 ||
    /\b(SRL|S\.R\.L\.|SNC|SAS|SPA|S\.P\.A\.)\b/i.test(raw);
  if (isAzienda) {
    return {
      type: "AZIENDA" as const,
      companyName: name,
      firstName: null,
      lastName: null,
    };
  }
  const parts = name.split(/\s+/).filter(Boolean);
  return {
    type: "PRIVATO" as const,
    lastName: parts[0] ?? name,
    firstName: parts.slice(1).join(" ") || null,
    companyName: null,
  };
}

async function main() {
  const laforgia = await prisma.user.findFirst({
    where: { name: { equals: "Laforgia Vito", mode: "insensitive" } },
  });
  const helios = await prisma.supplier.findFirst({
    where: { name: { equals: "Helios", mode: "insensitive" } },
  });
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", active: true },
    orderBy: { createdAt: "asc" },
  });
  if (!laforgia || !helios || !admin) throw new Error("Setup mancante");

  const buf = fs.readFileSync(FILE);
  const parsed = await parseHeliosProvvigioniBuffer(buf, PERIOD);
  if (!parsed.ok) throw new Error(parsed.error);
  const byPod = new Map(parsed.lines.map((l) => [l.pod, l]));

  for (const w of WRONG) {
    const line = byPod.get(w.pod);
    if (!line) continue;

    const wrong = await prisma.contract.findFirst({
      where: {
        OR: [{ podPdr: w.pod }, { pod: w.pod }],
        client: {
          OR: [
            { lastName: { contains: w.wrongName.split(" ")[0], mode: "insensitive" } },
            { companyName: { contains: w.wrongName.split(" ")[0], mode: "insensitive" } },
          ],
        },
      },
      include: {
        client: true,
        recurringMonths: { where: { period: PERIOD } },
      },
    });
    if (!wrong) {
      console.log("non trovato wrong", w.pod, w.wrongName);
      continue;
    }

    const dn = clientDisplayName(wrong.client);
    if (!dn.toUpperCase().includes(w.wrongName.split(" ")[0]!)) {
      console.log("skip nome diverso", w.pod, dn);
      continue;
    }

    // Rimuovi giugno PAID errato
    const june = wrong.recurringMonths[0];
    if (june) {
      await prisma.recurringMonth.delete({ where: { id: june.id } });
    }

    // Ripristina POD originale o vuoto
    await prisma.contract.update({
      where: { id: wrong.id },
      data: {
        podPdr: w.restorePod ?? null,
        pod: w.restorePod ?? null,
        paymentStatus: w.restorePod ? wrong.paymentStatus : "Da incassare",
        collectionDate: w.restorePod ? wrong.collectionDate : null,
      },
    });
    console.log(`↩ ripristinato ${dn} | POD → ${w.restorePod ?? "(vuoto)"}`);

    // Contratto giusto per intestatario Excel
    const existingRight = await prisma.contract.findFirst({
      where: {
        supplierId: helios.id,
        deletedAt: null,
        OR: [{ podPdr: w.pod }, { pod: w.pod }],
        NOT: { id: wrong.id },
      },
      include: { recurringMonths: { where: { period: PERIOD } } },
    });

    if (existingRight) {
      const j = existingRight.recurringMonths[0];
      if (!j || j.status !== "PAID") {
        if (j) {
          await prisma.recurringMonth.update({
            where: { id: j.id },
            data: { status: "PAID", paidAt: new Date(), settledPeriod: PERIOD },
          });
        } else {
          await prisma.recurringMonth.create({
            data: {
              contractId: existingRight.id,
              period: PERIOD,
              status: "PAID",
              paidAt: new Date(),
              settledPeriod: PERIOD,
              amount: line.baseAmount,
            },
          });
        }
      }
      await prisma.contract.update({
        where: { id: existingRight.id },
        data: { collaboratorId: laforgia.id, podPdr: w.pod, pod: w.pod },
      });
      console.log(`✓ già esiste contratto corretto per ${line.intestatario}`);
      continue;
    }

    const clientFields = parseName(line.intestatario, line.baseAmount);
    const client = await prisma.client.create({
      data: { ...clientFields, createdById: admin.id },
    });
    const cn = await allocateContractNumber();
    const c = await prisma.contract.create({
      data: {
        contractNumber: cn,
        externalId: `helios-giu2026-fix-${w.pod}`.slice(0, 80),
        clientId: client.id,
        collaboratorId: laforgia.id,
        createdById: admin.id,
        supplierId: helios.id,
        status: "PAGATO_DAL_FORNITORE",
        podPdr: w.pod,
        pod: w.pod,
        recurrence: "Ricorrente",
        utilityType: "Luce",
        operationType: "CAMBIO",
        insertionDate: new Date(2026, 5, 1),
        supplyStartDate: new Date(2026, 0, 1),
        paymentStatus: "Incassato",
        collectionDate: new Date(2026, 5, 1),
        isHistorical: false,
        notes: "Correzione import Helios giugno 2026",
      },
    });
    await prisma.commission.create({
      data: {
        contractId: c.id,
        expected: line.baseAmount >= 6 ? 6 : 4,
        received: 0,
        paid: 0,
        accrued: 0,
      },
    });
    await prisma.recurringMonth.create({
      data: {
        contractId: c.id,
        period: PERIOD,
        status: "PAID",
        paidAt: new Date(),
        settledPeriod: PERIOD,
        amount: line.baseAmount,
      },
    });
    console.log(`+ creato ${line.intestatario} | ${w.pod}`);
  }

  // Pulisci duplicati POD IT001E11522504 su contratti spuri
  const dupPod = "IT001E11522504";
  const dups = await prisma.contract.findMany({
    where: { OR: [{ podPdr: dupPod }, { pod: dupPod }] },
    include: { client: true, recurringMonths: { where: { period: PERIOD } } },
  });
  for (const d of dups) {
    const name = clientDisplayName(d.client);
    if (name.includes("MARTINO ALESSANDRO")) continue;
    if (name.includes("MARTINO ALFONSO") && d.podPdr === dupPod) continue;
    if (d.podPdr === dupPod || d.pod === dupPod) {
      await prisma.contract.update({
        where: { id: d.id },
        data: { podPdr: null, pod: null },
      });
      if (d.recurringMonths[0]) {
        await prisma.recurringMonth.delete({ where: { id: d.recurringMonths[0].id } });
      }
      console.log(`🧹 rimosso POD duplicato da ${name}`);
    }
  }

  // Duplicato MARTINO ALESSANDRO senza giugno incassato
  const dupMartino = await prisma.contract.findMany({
    where: {
      podPdr: "IT001E11522504",
      deletedAt: null,
      client: { lastName: { contains: "MARTINO", mode: "insensitive" } },
    },
    include: { recurringMonths: { where: { period: PERIOD } } },
  });
  for (const d of dupMartino) {
    if (d.recurringMonths.length === 0 && dupMartino.length > 1) {
      await prisma.contract.update({
        where: { id: d.id },
        data: {
          deletedAt: new Date(),
          internalNotes: "Duplicato rimosso (fix Helios giugno 2026)",
        },
      });
      console.log("🗑 duplicato rimosso", d.id);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
