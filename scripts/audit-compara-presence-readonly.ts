/**
 * Sola lettura: confronta nominativi Compara Agosto con clienti/contratti Neon.
 * Uso: npx tsx scripts/audit-compara-presence-readonly.ts
 * NON scrive nulla.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { comparaAgostoTemplateConfig } from "../src/lib/compara-agosto/template";
import { resolveComparaSupplierMatch } from "../src/lib/compara-agosto/supplier-match";
import { fuzzyPersonKey } from "../src/lib/payout/normalize";
import {
  loadPayoutContractIndex,
  matchPayoutRow,
} from "../src/lib/payout/match";
import { parsePayoutWorkbook } from "../src/lib/payout/parse";
import { clientDisplayName } from "../src/lib/utils";
import { normalizePersonKey } from "../src/lib/helios-provvigioni-shared";

const SAMPLE = [
  "Ada Bernardoni",
  "Alberto Maruccia",
  "ALFONSO ZIMBARDI",
  "ANDREA BAZZANO",
  "ANGELO CALAMO",
  "ANGELO CONDEMI",
  "Antonietta Principe",
  "RUSSO ANTONIO",
  "Bruno Sibilio",
  "Calogero Ingrao",
  "CARLA PINTI",
  "Claudio De Angelis",
  "Dalila Cristiana Profilo",
  "DANIELA TINTI",
  "FABIO CUTARELLI",
  "Fernando Ciarafoni",
  "Giovanni Micieli",
  "GIOVANNI MONDA",
  "Giuseppe Miserotti",
  "LUCA GIANNINI",
  "LUCA PATRICELLI",
  "MARIA BONSIGNORE",
  "MARIA NUZZO",
  "Massimo Grecchi",
  "MASSIMO SPADONI",
  "MICHELE MONTAGNA",
  "MINO BRUNETTI",
  "PALMA CIRACI",
  "PAOLO FERRARI",
];

function tokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function nameVariants(name: string): string[] {
  const t = tokens(name);
  const out = new Set<string>();
  out.add(t.join(" "));
  if (t.length >= 2) out.add([...t].reverse().join(" "));
  // cognome + nome (ultime parole come cognome composto)
  if (t.length >= 3) {
    out.add(`${t[t.length - 1]} ${t.slice(0, -1).join(" ")}`);
    out.add(`${t.slice(1).join(" ")} ${t[0]}`);
  }
  return [...out];
}

function keysFor(name: string): string[] {
  const out = new Set<string>();
  for (const v of nameVariants(name)) {
    const k = fuzzyPersonKey(v);
    if (k) out.add(k);
    const n = normalizePersonKey(v);
    if (n) out.add(n);
  }
  return [...out];
}

type Hit = {
  sourceName: string;
  clientId: string;
  clientName: string;
  clientDeleted: boolean;
  contractId: string | null;
  contractNumber: string | null;
  status: string | null;
  paymentStatus: string | null;
  isHistorical: boolean;
  contractDeleted: boolean;
  supplier: string | null;
  collaborator: string | null;
  pod: string | null;
  recurrence: string | null;
  commissionPaid: number | null;
  recurringStatuses: string[];
};

async function main() {
  const outPath =
    process.env.AUDIT_OUT ||
    "/opt/cursor/artifacts/compara-presence-audit.json";

  try {
    const xlsxPath = join(
      "/cursor/stores/self/docs",
      "COMPARA_AGOSTO.xlsx",
    );
    if (!existsSync(xlsxPath)) {
      throw new Error(`Manca file ${xlsxPath}`);
    }
    const buffer = readFileSync(xlsxPath);
    const parsed = await parsePayoutWorkbook(
      buffer,
      comparaAgostoTemplateConfig(),
    );
    if (!parsed.ok) {
      throw new Error(`Parse Compara fallito: ${parsed.error}`);
    }
    console.log(
      `File Compara: ${parsed.rows.length} righe OK, fogli ${parsed.sheetsRead.join(",")}`,
    );

    // Indice Compara attuale (esclude historical + deleted)
    const index = await loadPayoutContractIndex();
    console.log(`Indice payout attivi: ${index.size} contratti`);

    // Tutti i clienti (anche deleted) per ricerca ampia
    const clients = await prisma.client.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        companyName: true,
        type: true,
        deletedAt: true,
        contracts: {
          select: {
            id: true,
            contractNumber: true,
            status: true,
            paymentStatus: true,
            isHistorical: true,
            deletedAt: true,
            pod: true,
            pdr: true,
            podPdr: true,
            recurrence: true,
            supplier: { select: { name: true } },
            collaborator: { select: { name: true } },
            commission: {
              select: { paid: true, received: true, expected: true },
            },
            recurringMonths: {
              select: { period: true, status: true, amount: true },
              take: 24,
              orderBy: { period: "desc" },
            },
          },
        },
      },
    });
    console.log(`Clienti in DB: ${clients.length}`);

    type ClientRow = (typeof clients)[number];
    const byNameKey = new Map<string, ClientRow[]>();
    for (const c of clients) {
      const display = clientDisplayName(c);
      for (const k of keysFor(display)) {
        const list = byNameKey.get(k) ?? [];
        list.push(c);
        byNameKey.set(k, list);
      }
      if (c.lastName) {
        for (const k of keysFor(c.lastName)) {
          const list = byNameKey.get(k) ?? [];
          if (!list.includes(c)) list.push(c);
          byNameKey.set(k, list);
        }
      }
    }

    function findClients(name: string): ClientRow[] {
      const found = new Map<string, ClientRow>();
      for (const k of keysFor(name)) {
        for (const c of byNameKey.get(k) ?? []) found.set(c.id, c);
      }
      // Fallback: token cognome+nome overlap
      const want = new Set(tokens(name));
      if (found.size === 0 && want.size >= 2) {
        for (const c of clients) {
          const have = new Set(tokens(clientDisplayName(c)));
          let overlap = 0;
          for (const t of want) if (have.has(t)) overlap++;
          if (overlap >= Math.min(2, want.size)) found.set(c.id, c);
        }
      }
      return [...found.values()];
    }

    function hitsFor(name: string): Hit[] {
      const hits: Hit[] = [];
      for (const c of findClients(name)) {
        const display = clientDisplayName(c);
        if (c.contracts.length === 0) {
          hits.push({
            sourceName: name,
            clientId: c.id,
            clientName: display,
            clientDeleted: c.deletedAt != null,
            contractId: null,
            contractNumber: null,
            status: null,
            paymentStatus: null,
            isHistorical: false,
            contractDeleted: false,
            supplier: null,
            collaborator: null,
            pod: null,
            recurrence: null,
            commissionPaid: null,
            recurringStatuses: [],
          });
          continue;
        }
        for (const ct of c.contracts) {
          hits.push({
            sourceName: name,
            clientId: c.id,
            clientName: display,
            clientDeleted: c.deletedAt != null,
            contractId: ct.id,
            contractNumber: ct.contractNumber,
            status: ct.status,
            paymentStatus: ct.paymentStatus,
            isHistorical: ct.isHistorical,
            contractDeleted: ct.deletedAt != null,
            supplier: ct.supplier.name,
            collaborator: ct.collaborator.name,
            pod: ct.podPdr || ct.pod || ct.pdr,
            recurrence: ct.recurrence,
            commissionPaid:
              ct.commission?.paid != null
                ? Number(ct.commission.paid)
                : null,
            recurringStatuses: ct.recurringMonths.map(
              (m) => `${m.period}:${m.status}`,
            ),
          });
        }
      }
      return hits;
    }

    // --- Campione Michele ---
    const sampleReport: Array<{
      name: string;
      dbHits: number;
      inActiveIndex: boolean;
      comparaWould: "present" | "needs_create" | "n/a";
      hits: Hit[];
      reason?: string;
    }> = [];

    for (const name of SAMPLE) {
      const hits = hitsFor(name);
      const active = hits.some(
        (h) =>
          h.contractId &&
          !h.contractDeleted &&
          !h.isHistorical &&
          !h.clientDeleted,
      );
      sampleReport.push({
        name,
        dbHits: hits.length,
        inActiveIndex: active,
        comparaWould: "n/a",
        hits,
      });
    }

    // --- Tutte le righe file: match Compara attuale ---
    const fileRows: Array<{
      nominativo: string;
      supplier: string;
      pod: string;
      amount: number | null;
      presence: "present" | "needs_create";
      matchReason: string | null;
      mismatchedSupplier: string | null;
      matchedContractId: string | null;
      matchedSupplier: string | null;
      dbHitsOutsideIndex: Hit[];
      falseNegative: boolean;
      falseNegativeWhy: string | null;
    }> = [];

    for (const row of parsed.rows) {
      const withPeriod = { ...row, period: row.period ?? "2026-08" };
      const outcome = matchPayoutRow(withPeriod, index);
      let matched =
        outcome.status === "matched"
          ? outcome.contract
          : outcome.status === "ambiguous"
            ? (outcome.candidates[0] ?? null)
            : null;
      let ambiguous = outcome.status === "ambiguous";
      let matchReason =
        outcome.status === "unmatched" ? null : outcome.reason;
      let matchScore =
        outcome.status === "unmatched" ? null : outcome.score;
      let candidateIds =
        outcome.status === "matched"
          ? [outcome.contract.id]
          : outcome.status === "ambiguous"
            ? outcome.candidates.map((c) => c.id)
            : [];

      const resolved = resolveComparaSupplierMatch({
        index,
        row: withPeriod,
        matched,
        ambiguous,
        matchReason,
        matchScore,
        candidateIds,
      });

      const presence =
        resolved.contract == null ? "needs_create" : "present";

      const dbHits = hitsFor(row.clientNameRaw);
      // Contratti esistenti ma fuori indice (historical/deleted) o match fallito
      const outside = dbHits.filter(
        (h) =>
          h.contractId &&
          (h.isHistorical ||
            h.contractDeleted ||
            h.clientDeleted ||
            (presence === "needs_create" &&
              !h.isHistorical &&
              !h.contractDeleted &&
              !h.clientDeleted)),
      );

      let falseNegative = false;
      let falseNegativeWhy: string | null = null;
      if (presence === "needs_create") {
        const activeHits = dbHits.filter(
          (h) =>
            h.contractId &&
            !h.isHistorical &&
            !h.contractDeleted &&
            !h.clientDeleted,
        );
        if (activeHits.length > 0) {
          falseNegative = true;
          const suppliers = [
            ...new Set(activeHits.map((h) => h.supplier).filter(Boolean)),
          ];
          falseNegativeWhy = `Contratti attivi in DB (${activeHits.length}) fornitori=[${suppliers.join(", ")}] file=${row.supplierHint}; match/supplier fallback fallito`;
        } else if (
          dbHits.some((h) => h.contractId && h.isHistorical && !h.contractDeleted)
        ) {
          falseNegative = true;
          falseNegativeWhy =
            "Contratto solo isHistorical=true (escluso da loadPayoutContractIndex)";
        } else if (dbHits.some((h) => h.contractDeleted || h.clientDeleted)) {
          falseNegative = true;
          falseNegativeWhy = "Solo in cestino (deletedAt)";
        }
      }

      fileRows.push({
        nominativo: row.clientNameRaw,
        supplier: row.supplierHint,
        pod: row.podRaw,
        amount: row.amount,
        presence,
        matchReason: resolved.matchReason,
        mismatchedSupplier: resolved.mismatchedSupplierName,
        matchedContractId: resolved.contract?.id ?? null,
        matchedSupplier: resolved.contract?.supplierName ?? null,
        dbHitsOutsideIndex: outside,
        falseNegative,
        falseNegativeWhy,
      });
    }

    const needsCreate = fileRows.filter((r) => r.presence === "needs_create");
    const present = fileRows.filter((r) => r.presence === "present");
    const falseNegatives = fileRows.filter((r) => r.falseNegative);

    // Arricchisci campione con presence dal file
    for (const s of sampleReport) {
      const fileHits = fileRows.filter(
        (r) =>
          keysFor(r.nominativo).some((k) => keysFor(s.name).includes(k)) ||
          tokens(r.nominativo).join(" ") === tokens(s.name).join(" ") ||
          tokens(r.nominativo).join(" ") ===
            tokens(s.name).reverse().join(" "),
      );
      if (fileHits.length > 0) {
        s.comparaWould = fileHits.some((f) => f.presence === "present")
          ? "present"
          : "needs_create";
        s.reason = fileHits.map((f) => f.falseNegativeWhy || f.presence).join(" | ");
      }
    }

    const summary = {
      fileRows: parsed.rows.length,
      present: present.length,
      needsCreate: needsCreate.length,
      falseNegatives: falseNegatives.length,
      falseNegativeHistorical: falseNegatives.filter((r) =>
        r.falseNegativeWhy?.includes("isHistorical"),
      ).length,
      falseNegativeActiveButUnmatched: falseNegatives.filter((r) =>
        r.falseNegativeWhy?.includes("Contratti attivi"),
      ).length,
      falseNegativeDeleted: falseNegatives.filter((r) =>
        r.falseNegativeWhy?.includes("cestino"),
      ).length,
      trulyAbsent: needsCreate.filter((r) => !r.falseNegative).length,
      indexSize: index.size,
      sampleFound: sampleReport.filter((s) => s.dbHits > 0).length,
      sampleAbsent: sampleReport.filter((s) => s.dbHits === 0).length,
    };

    console.log("\n=== SUMMARY ===");
    console.log(JSON.stringify(summary, null, 2));

    console.log("\n=== SAMPLE ===");
    for (const s of sampleReport) {
      const flag =
        s.dbHits === 0
          ? "ASSENTE"
          : s.inActiveIndex
            ? "ATTIVO"
            : "SOLO_STORICO/CESTINO";
      console.log(
        `${flag}\t${s.name}\tcompara=${s.comparaWould}\thits=${s.dbHits}\t${s.reason ?? ""}`,
      );
      for (const h of s.hits.slice(0, 5)) {
        console.log(
          `  → ${h.clientName} | ${h.contractNumber ?? "no-contract"} | ${h.supplier ?? "-"} | status=${h.status} pay=${h.paymentStatus} hist=${h.isHistorical} del=${h.contractDeleted} pod=${h.pod ?? "-"} rates=[${h.recurringStatuses.slice(0, 3).join(",")}]`,
        );
      }
    }

    console.log("\n=== NEEDS_CREATE FALSE NEGATIVES ===");
    for (const r of falseNegatives) {
      console.log(
        `${r.nominativo}\t${r.supplier}\t${r.pod}\t${r.falseNegativeWhy}`,
      );
    }

    console.log("\n=== TRULY ABSENT (needs_create, no DB hit) ===");
    const absent = needsCreate.filter((r) => !r.falseNegative);
    for (const r of absent.slice(0, 80)) {
      console.log(`${r.nominativo}\t${r.supplier}\t${r.pod}`);
    }

    const payload = {
      summary,
      sampleReport,
      needsCreate,
      falseNegatives,
      trulyAbsent: absent,
      presentCount: present.length,
    };
    writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(`\nJSON → ${outPath}`);
  } finally {
    // prisma singleton: no disconnect required in short scripts
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
