/**
 * Soft-delete doppioni creati oggi da stub Compara, tenendo l'originale CRM.
 *
 * DRY-RUN (default): npx tsx scripts/cleanup-compara-duplicates.ts
 * APPLY:            APPLY=1 npx tsx scripts/cleanup-compara-duplicates.ts
 *
 * Non tocca: Francesca Di Lalla, Francesca Romana Colucci, Veronica Verita.
 */
import Module from "module";
import path from "path";
const orig = (Module as unknown as { _resolveFilename: Function })
  ._resolveFilename;
(Module as unknown as { _resolveFilename: Function })._resolveFilename =
  function (
    request: string,
    parent: unknown,
    isMain: boolean,
    options: unknown,
  ) {
    if (request === "server-only") {
      return path.join(process.cwd(), "node_modules/server-only/index.js");
    }
    return orig.call(this, request, parent, isMain, options);
  };

import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { classifyComparaSupplier } from "../src/lib/compara-agosto/amounts";
import { fuzzyPersonKey } from "../src/lib/payout/normalize";
import { clientDisplayName } from "../src/lib/utils";

const APPLY = process.env.APPLY === "1";
const OUT =
  process.env.CLEANUP_OUT ||
  "/opt/cursor/artifacts/compara-duplicates-cleanup.json";

/** Oggi 2026-10-10 Europe/Rome ≈ UTC+2 in ottobre → [2026-10-09T22:00Z, 2026-10-10T22:00Z) */
const DAY_START = new Date("2026-10-09T22:00:00.000Z");
const DAY_END = new Date("2026-10-10T22:00:00.000Z");

const PROTECTED = [
  "DI LALLA FRANCESCA",
  "FRANCESCA DI LALLA",
  "COLUCCI FRANCESCA ROMANA",
  "FRANCESCA ROMANA COLUCCI",
  "VERITA VERONICA",
  "VERONICA VERITA",
];

function personKeys(name: string): string[] {
  const k = fuzzyPersonKey(name);
  const words = k.split(/\s+/).filter(Boolean);
  const out = new Set<string>([k]);
  if (words.length >= 2) {
    out.add(`${words[words.length - 1]} ${words.slice(0, -1).join(" ")}`);
    out.add(`${words.slice(1).join(" ")} ${words[0]}`);
  }
  return [...out];
}

function isProtected(name: string): boolean {
  const keys = new Set(personKeys(name));
  for (const p of PROTECTED) {
    for (const pk of personKeys(p)) {
      if (keys.has(pk)) return true;
    }
  }
  return false;
}

function supplierKind(name: string): string {
  return classifyComparaSupplier(name);
}

function isComparaStub(c: {
  productName: string | null;
  clientNotes: string | null;
  createdAt: Date;
}): boolean {
  const product = (c.productName ?? "").trim();
  const notes = (c.clientNotes ?? "").trim();
  const fromProduct = /^Compara\b/i.test(product);
  const fromNotes = /Creato da import Compara/i.test(notes);
  const today =
    c.createdAt.getTime() >= DAY_START.getTime() &&
    c.createdAt.getTime() < DAY_END.getTime();
  return today && (fromProduct || fromNotes);
}

type Row = {
  id: string;
  contractNumber: string;
  status: string;
  paymentStatus: string | null;
  productName: string | null;
  podPdr: string | null;
  pod: string | null;
  pdr: string | null;
  createdAt: Date;
  insertionDate: Date;
  deletedAt: Date | null;
  isHistorical: boolean;
  supplierName: string;
  clientId: string;
  clientName: string;
  clientNotes: string | null;
  clientCreatedAt: Date;
  clientDeletedAt: Date | null;
};

async function main() {
  const contracts = await prisma.contract.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      contractNumber: true,
      status: true,
      paymentStatus: true,
      productName: true,
      podPdr: true,
      pod: true,
      pdr: true,
      createdAt: true,
      insertionDate: true,
      deletedAt: true,
      isHistorical: true,
      supplier: { select: { name: true } },
      client: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          companyName: true,
          type: true,
          notes: true,
          createdAt: true,
          deletedAt: true,
        },
      },
    },
  });

  const rows: Row[] = contracts.map((c) => ({
    id: c.id,
    contractNumber: c.contractNumber,
    status: c.status,
    paymentStatus: c.paymentStatus,
    productName: c.productName,
    podPdr: c.podPdr,
    pod: c.pod,
    pdr: c.pdr,
    createdAt: c.createdAt,
    insertionDate: c.insertionDate,
    deletedAt: c.deletedAt,
    isHistorical: c.isHistorical,
    supplierName: c.supplier.name,
    clientId: c.client.id,
    clientName: clientDisplayName(c.client),
    clientNotes: c.client.notes,
    clientCreatedAt: c.client.createdAt,
    clientDeletedAt: c.client.deletedAt,
  }));

  const stubs = rows.filter((r) =>
    isComparaStub({
      productName: r.productName,
      clientNotes: r.clientNotes,
      createdAt: r.createdAt,
    }),
  );

  console.log(
    `Contratti attivi: ${rows.length}; stub Compara oggi: ${stubs.length}; APPLY=${APPLY}`,
  );

  type Decision =
    | {
        action: "delete_stub";
        stub: Row;
        original: Row;
        reason: string;
      }
    | {
        action: "skip_protected";
        stub: Row;
        reason: string;
      }
    | {
        action: "skip_no_original";
        stub: Row;
        reason: string;
      }
    | {
        action: "ambiguous";
        stub: Row;
        candidates: Row[];
        reason: string;
      };

  const decisions: Decision[] = [];

  for (const stub of stubs) {
    if (isProtected(stub.clientName)) {
      decisions.push({
        action: "skip_protected",
        stub,
        reason: "Nominativo protetto (Iren nuovo legittimo)",
      });
      continue;
    }

    const stubKeys = new Set(personKeys(stub.clientName));
    const stubKind = supplierKind(stub.supplierName);

    const originals = rows.filter((o) => {
      if (o.id === stub.id) return false;
      if (o.deletedAt) return false;
      // Originale = non stub Compara di oggi, creato prima dello stub
      const oIsStubToday = isComparaStub({
        productName: o.productName,
        clientNotes: o.clientNotes,
        createdAt: o.createdAt,
      });
      if (oIsStubToday) return false;
      if (o.createdAt.getTime() >= stub.createdAt.getTime()) return false;
      const oKind = supplierKind(o.supplierName);
      if (stubKind !== "other" && oKind !== "other") {
        if (stubKind !== oKind) return false;
      } else if (
        stub.supplierName.toLowerCase() !== o.supplierName.toLowerCase() &&
        !stub.supplierName
          .toLowerCase()
          .includes(o.supplierName.toLowerCase().slice(0, 4))
      ) {
        // rough fallback
        if (stubKind !== oKind) return false;
      }
      const oKeys = personKeys(o.clientName);
      return oKeys.some((k) => stubKeys.has(k));
    });

    if (originals.length === 0) {
      decisions.push({
        action: "skip_no_original",
        stub,
        reason: "Nessun contratto precedente stesso nominativo+fornitore",
      });
      continue;
    }

    // Match nome troppo largo (solo cognome comune) → ambiguous, non cancellare
    const stubFull = fuzzyPersonKey(stub.clientName);
    const strong = originals.filter((o) => {
      const oFull = fuzzyPersonKey(o.clientName);
      const stubWords = stubFull.split(/\s+/);
      const oWords = oFull.split(/\s+/);
      // almeno 2 token in comune (nome+cognome), non solo cognome
      const common = stubWords.filter((w) => oWords.includes(w) && w.length > 2);
      return common.length >= 2 || stubFull === oFull;
    });
    if (strong.length === 0) {
      decisions.push({
        action: "ambiguous",
        stub,
        candidates: originals,
        reason: "Match solo debole sul cognome — non cancello",
      });
      continue;
    }

    const oldest = strong
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]!;
    decisions.push({
      action: "delete_stub",
      stub,
      original: oldest,
      reason: `Doppione stub Compara oggi; tiene originale ${oldest.contractNumber} (e gli altri pre-esistenti)`,
    });
  }

  const toDelete = decisions.filter((d) => d.action === "delete_stub");
  const protectedSkip = decisions.filter((d) => d.action === "skip_protected");
  const noOriginal = decisions.filter((d) => d.action === "skip_no_original");
  const ambiguous = decisions.filter((d) => d.action === "ambiguous");

  console.log(
    JSON.stringify(
      {
        stubsToday: stubs.length,
        delete: toDelete.length,
        protected: protectedSkip.length,
        noOriginal: noOriginal.length,
        ambiguous: ambiguous.length,
      },
      null,
      2,
    ),
  );

  for (const d of toDelete) {
    if (d.action !== "delete_stub") continue;
    console.log(
      `DELETE ${d.stub.contractNumber} (${d.stub.id}) ${d.stub.clientName}/${d.stub.supplierName} ← keep ${d.original.contractNumber} (${d.original.id}) · ${d.reason}`,
    );
  }
  for (const d of protectedSkip) {
    console.log(
      `KEEP_PROTECTED ${d.stub.contractNumber} ${d.stub.clientName}/${d.stub.supplierName}`,
    );
  }
  for (const d of noOriginal) {
    console.log(
      `KEEP_NO_ORIG ${d.stub.contractNumber} ${d.stub.clientName}/${d.stub.supplierName}`,
    );
  }
  for (const d of ambiguous) {
    if (d.action !== "ambiguous") continue;
    console.log(
      `AMBIGUOUS ${d.stub.contractNumber} ${d.stub.clientName} candidates=${d.candidates.map((c) => c.contractNumber).join(",")}`,
    );
  }

  const applied: Array<{
    stubContractId: string;
    stubContractNumber: string;
    stubClientId: string;
    clientSoftDeleted: boolean;
    originalContractId: string;
    originalContractNumber: string;
  }> = [];

  if (APPLY) {
    const now = new Date();
    // system user for audit: first admin or first user
    const admin = await prisma.user.findFirst({
      where: { role: "ADMIN", active: true },
      select: { id: true },
    });
    const actorId = admin?.id ?? "compara-cleanup";

    for (const d of toDelete) {
      if (d.action !== "delete_stub") continue;
      const prevStatus = d.stub.status;
      await prisma.contract.update({
        where: { id: d.stub.id },
        data: { deletedAt: now, status: "ANNULLATO" },
      });
      await prisma.auditLog.create({
        data: {
          userId: actorId,
          action: "SOFT_DELETE",
          entity: "Contract",
          entityId: d.stub.id,
          details: JSON.stringify({
            reason: "compara_duplicate_cleanup",
            previousStatus: prevStatus,
            keptOriginalId: d.original.id,
            keptOriginalNumber: d.original.contractNumber,
            deletedAt: now.toISOString(),
          }),
        },
      });

      let clientSoftDeleted = false;
      const stubClientId = d.stub.clientId;
      // Soft-delete cliente solo se nato oggi da Compara e senza altri contratti attivi
      const clientIsComparaToday =
        /Creato da import Compara/i.test(d.stub.clientNotes ?? "") &&
        d.stub.clientCreatedAt.getTime() >= DAY_START.getTime() &&
        d.stub.clientCreatedAt.getTime() < DAY_END.getTime();
      if (clientIsComparaToday && !d.stub.clientDeletedAt) {
        const other = await prisma.contract.count({
          where: {
            clientId: stubClientId,
            deletedAt: null,
            id: { not: d.stub.id },
          },
        });
        if (other === 0) {
          await prisma.client.update({
            where: { id: stubClientId },
            data: { deletedAt: now },
          });
          await prisma.auditLog.create({
            data: {
              userId: actorId,
              action: "SOFT_DELETE",
              entity: "Client",
              entityId: stubClientId,
              details: JSON.stringify({
                reason: "compara_duplicate_cleanup_orphan_client",
                afterContract: d.stub.id,
              }),
            },
          });
          clientSoftDeleted = true;
        }
      }

      applied.push({
        stubContractId: d.stub.id,
        stubContractNumber: d.stub.contractNumber,
        stubClientId,
        clientSoftDeleted,
        originalContractId: d.original.id,
        originalContractNumber: d.original.contractNumber,
      });
      console.log(
        `APPLIED soft-delete ${d.stub.contractNumber} clientDeleted=${clientSoftDeleted}`,
      );
    }
  }

  const payload = {
    apply: APPLY,
    dayStart: DAY_START.toISOString(),
    dayEnd: DAY_END.toISOString(),
    summary: {
      stubsToday: stubs.length,
      deleted: APPLY ? applied.length : toDelete.length,
      protectedKept: protectedSkip.length,
      noOriginalKept: noOriginal.length,
      ambiguous: ambiguous.length,
    },
    toDelete: toDelete.map((d) =>
      d.action === "delete_stub"
        ? {
            stubId: d.stub.id,
            stubNumber: d.stub.contractNumber,
            stubClient: d.stub.clientName,
            stubSupplier: d.stub.supplierName,
            stubPod: d.stub.podPdr || d.stub.pod || d.stub.pdr,
            stubCreatedAt: d.stub.createdAt.toISOString(),
            keepId: d.original.id,
            keepNumber: d.original.contractNumber,
            keepClient: d.original.clientName,
            keepSupplier: d.original.supplierName,
            keepPod: d.original.podPdr || d.original.pod || d.original.pdr,
            reason: d.reason,
          }
        : null,
    ),
    protectedKept: protectedSkip.map((d) => ({
      id: d.stub.id,
      number: d.stub.contractNumber,
      name: d.stub.clientName,
      supplier: d.stub.supplierName,
    })),
    noOriginalKept: noOriginal.map((d) => ({
      id: d.stub.id,
      number: d.stub.contractNumber,
      name: d.stub.clientName,
      supplier: d.stub.supplierName,
    })),
    ambiguous: ambiguous.map((d) =>
      d.action === "ambiguous"
        ? {
            stubId: d.stub.id,
            stubNumber: d.stub.contractNumber,
            name: d.stub.clientName,
            candidates: d.candidates.map((c) => ({
              id: c.id,
              number: c.contractNumber,
              supplier: c.supplierName,
            })),
          }
        : null,
    ),
    applied,
  };
  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(`JSON → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
