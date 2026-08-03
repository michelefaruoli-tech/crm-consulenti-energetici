/**
 * Applica rendiconto Broker Utenze luglio 2026 (PDF 8800).
 *
 * - Incassato + data 01/07/2026 su tutte le voci del PDF
 * - Collaboratore: Laforgia Vito (Moretti Michele → Michele)
 * - Ricorrenza: R per Sinergy/Etruria, M per gli altri (Sorgenia, Duferco, …)
 *
 * Uso:
 *   npx tsx scripts/apply-broker-utenze-luglio-2026.ts --dry
 *   npx tsx scripts/apply-broker-utenze-luglio-2026.ts
 */
import "dotenv/config";
import fs from "node:fs";
import pdf from "pdf-parse";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import { clientDisplayName } from "../src/lib/utils";
import { syncRecurringMonthsForContract } from "../src/lib/recurring-sync";

const DRY = process.argv.includes("--dry");
const PDF =
  "c:/Users/miche/Downloads/Consulenza_Utenza_s.r.l._-_IT002076850508_rendiconto_8800 (1).pdf";
const SETTLED = "2026-07";
const COLLECTION = new Date(2026, 6, 1);

type PdfRow = {
  pratica: string;
  date: string;
  client: string;
  product: string;
  amount: number;
  supplierHint: string | null;
  podHint: string | null;
};

type ContractRow = {
  id: string;
  podPdr: string | null;
  recurrence: string | null;
  status: string;
  clientName: string;
  supplierId: string;
  supplierName: string;
  collaboratorId: string;
  commissionId: string | null;
};

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizePod(s: string | null | undefined): string {
  return (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function supplierFromProduct(product: string): string | null {
  const p = product.toLowerCase();
  if (/sinergy/.test(p)) return "Sinergy";
  if (/etruria/.test(p)) return "Etruria";
  if (/sorgenia/.test(p)) return "Sorgenia";
  if (/duferco/.test(p)) return "Duferco";
  if (/helios/.test(p)) return "Helios";
  if (/enel/.test(p)) return "Enel";
  if (/plenitude|eni/.test(p)) return "Plenitude";
  return null;
}

function podFromProduct(product: string): string | null {
  const m =
    product.match(/\b((?:IT|it)[0-9a-z]{10,})\b/i) ||
    product.match(/\b(pdr|pod)\s*([0-9]{10,})\b/i);
  if (!m) return null;
  return normalizePod(m[2] ?? m[1]);
}

function recurrenceForSupplier(supplier: string | null): "M" | "R" {
  if (!supplier) return "M";
  if (/^(sinergy|etruria)$/i.test(supplier)) return "R";
  return "M";
}

function isMorettiMichele(client: string): boolean {
  const k = normalizeKey(client);
  return k.includes("moretti") && k.includes("michele") && !k.includes("autoservizi");
}

function parsePdfRows(text: string): PdfRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const rows: PdfRow[] = [];
  const headerRe = /^(\d{5,6})\s+(\d{2}\/\d{2}\/\d{4})$/;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(headerRe);
    if (!m) continue;
    const pratica = m[1]!;
    const date = m[2]!;
    const client = lines[i + 1] ?? "";
    const product = (lines[i + 2] ?? "").toLowerCase();
    let amount = 0;
    for (let j = i + 2; j < Math.min(i + 8, lines.length); j++) {
      const pct = lines[j]!.match(/(\d+[.,]\d{2})100\.0\s*%\s*(\d+[.,]\d{2})/);
      if (pct) {
        amount = Number(pct[2]!.replace(",", "."));
        break;
      }
    }
    if (!client || /via |melfi|rendiconto|consulenza|pagina|laforgia vito/i.test(client)) {
      continue;
    }
    rows.push({
      pratica,
      date,
      client,
      product,
      amount,
      supplierHint: supplierFromProduct(product),
      podHint: podFromProduct(product),
    });
  }
  return rows;
}

function nameScore(rowClient: string, contractName: string): number {
  const a = normalizeKey(rowClient);
  const b = normalizeKey(contractName);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (b.includes(a) || a.includes(b)) return 80;

  // Varianti note
  if (a.includes("fiorbianco") && b.includes("fiorbianco")) return 90;
  if (
    (a.includes("autoservizi") && a.includes("moretti")) ||
    (a.includes("moretti") && a.includes("autoservizi"))
  ) {
    if (b.includes("autolinee") || (b.includes("moretti") && b.includes("auto"))) return 95;
  }
  if (a.includes("autolinee") && b.includes("autolinee")) return 90;
  if (a.includes("novecento") && b.includes("novecento") && !b.includes("pos")) return 85;
  if (a.includes("basso") && a.includes("maria") && b.includes("basso") && b.includes("maria")) {
    return 85;
  }
  if (a.includes("santa rosa") && b.includes("santa rosa")) return 85;
  if (a.includes("gsa") && b.includes("gsa")) return 90;
  if (a.includes("best calze") && b.includes("best calze")) return 90;
  if (a.includes("metalvetro") && b.includes("metalvetro")) return 90;
  if (a.includes("elettrotermica") && b.includes("elettrotermica")) return 90;
  if (a.includes("vernetti") && b.includes("vernetti") && b.includes("antonio")) return 90;

  const parts = a.split(" ").filter((p) => p.length > 2);
  const hit = parts.filter((p) => b.includes(p)).length;
  if (hit >= Math.min(2, parts.length) && hit >= 2) return 55 + hit * 5;
  return 0;
}

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

async function main() {
  const buf = fs.readFileSync(PDF);
  const parsed = await pdf(buf);
  const rows = parsePdfRows(parsed.text);
  console.log({
    dry: DRY,
    pdfRows: rows.length,
    totalPdf: rows.reduce((s, r) => s + r.amount, 0),
  });

  const users = await prisma.user.findMany({
    where: {
      active: true,
      OR: [
        { name: { contains: "Laforgia", mode: "insensitive" } },
        { name: { equals: "Michele", mode: "insensitive" } },
        { email: { contains: "faruoli", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true },
  });
  const laforgia = users.find((u) => /laforgia/i.test(u.name));
  const michele =
    users.find((u) => /faruoli/i.test(u.email)) ??
    users.find((u) => /^michele$/i.test(u.name.trim()));
  if (!laforgia || !michele) throw new Error("Collaboratori Laforgia/Michele non trovati");
  console.log({ laforgia: laforgia.name, michele: `${michele.name} <${michele.email}>` });

  const suppliers = await prisma.supplier.findMany({
    where: { active: true },
    select: { id: true, name: true },
  });
  const supplierByName = new Map(
    suppliers.map((s) => [s.name.toLowerCase(), s] as const),
  );

  const rawContracts = await prisma.contract.findMany({
    where: { deletedAt: null, isHistorical: false },
    select: {
      id: true,
      podPdr: true,
      pod: true,
      pdr: true,
      recurrence: true,
      status: true,
      collaboratorId: true,
      client: {
        select: { type: true, firstName: true, lastName: true, companyName: true },
      },
      supplier: { select: { id: true, name: true } },
      commission: { select: { id: true } },
    },
  });

  const contracts: ContractRow[] = rawContracts.map((c) => ({
    id: c.id,
    podPdr: c.podPdr || c.pod || c.pdr || null,
    recurrence: c.recurrence,
    status: c.status,
    clientName: clientDisplayName(c.client),
    supplierId: c.supplier.id,
    supplierName: c.supplier.name,
    collaboratorId: c.collaboratorId,
    commissionId: c.commission?.id ?? null,
  }));

  const used = new Set<string>();
  type Match = {
    row: PdfRow;
    contract: ContractRow;
    score: number;
    collabId: string;
    recurrence: "M" | "R";
    fixSupplierTo: string | null;
  };
  const matches: Match[] = [];
  const unmatched: PdfRow[] = [];

  for (const row of rows) {
    const collabId = isMorettiMichele(row.client) ? michele.id : laforgia.id;
    const recurrence = recurrenceForSupplier(row.supplierHint);
    let best: { c: ContractRow; score: number; fixSupplierTo: string | null } | null =
      null;

    for (const c of contracts) {
      if (used.has(c.id)) continue;
      let score = 0;
      let fixSupplierTo: string | null = null;

      if (row.podHint) {
        const cp = normalizePod(c.podPdr);
        if (cp && (cp === row.podHint || cp.includes(row.podHint) || row.podHint.includes(cp))) {
          score += 200;
        }
      }

      const ns = nameScore(row.client, c.clientName);
      if (ns === 0 && score === 0) continue;
      score += ns;

      if (row.supplierHint) {
        if (c.supplierName.toLowerCase() === row.supplierHint.toLowerCase()) {
          score += 50;
        } else if (
          c.supplierName.toLowerCase() === "sconosciuto" ||
          c.supplierName.toLowerCase() === "helios"
        ) {
          // Consentito riallineare fornitore se il nome cliente combacia bene
          if (ns >= 80) {
            score += 10;
            fixSupplierTo = row.supplierHint;
          } else {
            score -= 40;
          }
        } else {
          score -= 60; // fornitore diverso e noto
        }
      }

      // Evita match deboli tipo "MORETTI" generico
      if (ns < 80 && score < 140) continue;

      if (!best || score > best.score) best = { c, score, fixSupplierTo };
    }

    if (!best || best.score < 70) {
      unmatched.push(row);
      continue;
    }

    used.add(best.c.id);
    matches.push({
      row,
      contract: best.c,
      score: best.score,
      collabId,
      recurrence,
      fixSupplierTo: best.fixSupplierTo,
    });
  }

  console.log({
    matched: matches.length,
    unmatched: unmatched.length,
    unmatchedRows: unmatched.map((u) => `${u.pratica} ${u.client} [${u.supplierHint}]`),
  });
  for (const m of matches) {
    console.log(
      `  ${m.row.pratica} ${m.row.client} → ${m.contract.clientName} [${m.contract.supplierName}${m.fixSupplierTo ? "→" + m.fixSupplierTo : ""}}] €${m.row.amount} ${m.recurrence} ${m.collabId === michele.id ? "Michele" : "Laforgia"} score=${m.score}`,
    );
  }

  if (DRY) {
    await prisma.$disconnect();
    return;
  }

  let updated = 0;
  for (const m of matches) {
    const keepStatus =
      m.contract.status === "PROVVIGIONE_LIQUIDATA" ||
      m.contract.status === "KO" ||
      m.contract.status === "CHIUSO" ||
      m.contract.status === "ANNULLATO";

    let supplierId = m.contract.supplierId;
    if (m.fixSupplierTo) {
      const s = supplierByName.get(m.fixSupplierTo.toLowerCase());
      if (s) supplierId = s.id;
    }

    await prisma.contract.update({
      where: { id: m.contract.id },
      data: {
        collaboratorId: m.collabId,
        recurrence: m.recurrence,
        collectionDate: COLLECTION,
        paymentStatus: "Incassato",
        supplierId,
        ...(keepStatus ? {} : { status: "PAGATO_DAL_FORNITORE" }),
      },
    });

    if (m.contract.commissionId && m.row.amount > 0) {
      await prisma.commission.update({
        where: { id: m.contract.commissionId },
        data: { expected: m.row.amount, received: m.row.amount },
      });
    }

    await syncRecurringMonthsForContract(m.contract.id);

    const openMissing = await prisma.recurringMonth.findMany({
      where: {
        contractId: m.contract.id,
        status: "MISSING",
        period: { lte: SETTLED },
      },
    });

    if (openMissing.length > 0) {
      for (const om of openMissing) {
        await prisma.recurringMonth.update({
          where: { id: om.id },
          data: {
            status: "PAID",
            paidAt: COLLECTION,
            settledPeriod: SETTLED,
            amount: m.row.amount || om.amount,
            note: `Broker Utenze rendiconto 8800 luglio 2026 pratica ${m.row.pratica}`,
          },
        });
      }
    } else {
      const july = await prisma.recurringMonth.findUnique({
        where: {
          contractId_period: { contractId: m.contract.id, period: SETTLED },
        },
      });
      if (!july) {
        await prisma.recurringMonth.create({
          data: {
            contractId: m.contract.id,
            period: SETTLED,
            status: "PAID",
            paidAt: COLLECTION,
            settledPeriod: SETTLED,
            amount: m.row.amount || null,
            note: `Broker Utenze rendiconto 8800 luglio 2026 pratica ${m.row.pratica}`,
          },
        });
      } else if (july.status !== "LIQUIDATED") {
        await prisma.recurringMonth.update({
          where: { id: july.id },
          data: {
            status: "PAID",
            paidAt: COLLECTION,
            settledPeriod: SETTLED,
            amount: m.row.amount || july.amount,
            note: `Broker Utenze rendiconto 8800 luglio 2026 pratica ${m.row.pratica}`,
          },
        });
      }
    }

    updated++;
  }

  console.log({ updated });
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
