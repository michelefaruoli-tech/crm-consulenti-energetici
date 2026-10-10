/**
 * Audit: contratti «salvati» non visibili nella lista Provvigioni default
 * (deletedAt=null, isHistorical=false, status∉KO/ANNULLATO/CHIUSO).
 *
 * DRY-RUN only (nessuna scrittura).
 * Uso: npx tsx scripts/audit-provvigioni-visibility.ts
 */
import Module from "module";
import path from "path";
const origResolve = (Module as unknown as { _resolveFilename: Function })
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
    return origResolve.call(this, request, parent, isMain, options);
  };

import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { buildProvvigioniContractWhere } from "../src/lib/provvigioni-filters";
import { clientDisplayName } from "../src/lib/utils";

const OUT =
  process.env.AUDIT_OUT ||
  "/opt/cursor/artifacts/provvigioni-visibility-audit.json";

const KO = new Set(["KO", "ANNULLATO", "CHIUSO"]);

async function main() {
  const total = await prisma.contract.count();
  const defaultWhere = buildProvvigioniContractWhere({
    canViewAll: true,
    sessionUserId: "audit",
  });
  const visibleDefault = await prisma.contract.count({ where: defaultWhere });

  // Tutti i contratti con campi utili (paginati)
  const reasons: Record<string, number> = {
    visible_default: 0,
    hidden_deletedAt: 0,
    hidden_deletedAt_compara_cleanup: 0,
    hidden_deletedAt_other: 0,
    hidden_historical: 0,
    hidden_ko_status: 0,
    hidden_annullato: 0,
    hidden_chiuso: 0,
    missing_commission_but_visible: 0,
    missing_commission_and_hidden: 0,
    // Incassato focus
    has_collection_but_liquidata: 0,
    pagato_dal_fornitore_visible: 0,
  };

  const samples: Record<string, Array<Record<string, unknown>>> = {
    deletedAt_other: [],
    historical: [],
    ko_status: [],
    missing_commission: [],
    liquidata_with_collection: [],
  };

  // Soft-delete con audit compara cleanup
  const cleanupAudits = await prisma.auditLog.findMany({
    where: {
      action: "SOFT_DELETE",
      entity: "Contract",
      details: { contains: "compara_duplicate_cleanup" },
    },
    select: { entityId: true },
  });
  const cleanupIds = new Set(cleanupAudits.map((a) => a.entityId));

  // Restore audits (non ri-annullare)
  const restoreAudits = await prisma.auditLog.findMany({
    where: {
      action: "RESTORE",
      entity: "Contract",
      details: { contains: "compara_stub_restore" },
    },
    select: { entityId: true },
  });
  const restoredIds = new Set(restoreAudits.map((a) => a.entityId));

  let cursor: string | undefined;
  let scanned = 0;
  const pageSize = 500;

  for (;;) {
    const page = await prisma.contract.findMany({
      take: pageSize,
      ...(cursor
        ? { skip: 1, cursor: { id: cursor } }
        : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        contractNumber: true,
        status: true,
        deletedAt: true,
        isHistorical: true,
        collectionDate: true,
        productName: true,
        client: {
          select: {
            firstName: true,
            lastName: true,
            companyName: true,
            type: true,
            deletedAt: true,
          },
        },
        supplier: { select: { name: true } },
        collaborator: { select: { name: true } },
        commission: { select: { id: true } },
      },
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1]!.id;
    scanned += page.length;

    for (const c of page) {
      const name = clientDisplayName(c.client);
      const base = {
        id: c.id,
        number: c.contractNumber,
        name,
        supplier: c.supplier?.name,
        status: c.status,
        collaborator: c.collaborator?.name,
        productName: c.productName,
      };

      const inDefault =
        !c.deletedAt && !c.isHistorical && !KO.has(c.status);

      if (inDefault) {
        reasons.visible_default++;
        if (!c.commission) {
          reasons.missing_commission_but_visible++;
          if (samples.missing_commission.length < 30) {
            samples.missing_commission.push({ ...base, note: "visible_no_commission" });
          }
        }
        if (c.status === "PAGATO_DAL_FORNITORE") {
          reasons.pagato_dal_fornitore_visible++;
        }
        if (
          c.status === "PROVVIGIONE_LIQUIDATA" &&
          c.collectionDate
        ) {
          reasons.has_collection_but_liquidata++;
        }
        continue;
      }

      if (!c.commission) reasons.missing_commission_and_hidden++;

      if (c.deletedAt) {
        reasons.hidden_deletedAt++;
        if (cleanupIds.has(c.id) && !restoredIds.has(c.id)) {
          reasons.hidden_deletedAt_compara_cleanup++;
        } else {
          reasons.hidden_deletedAt_other++;
          if (samples.deletedAt_other.length < 40) {
            samples.deletedAt_other.push({
              ...base,
              deletedAt: c.deletedAt.toISOString(),
              restored: restoredIds.has(c.id),
              wasCleanup: cleanupIds.has(c.id),
            });
          }
        }
        continue;
      }

      if (c.isHistorical) {
        reasons.hidden_historical++;
        if (samples.historical.length < 40) {
          samples.historical.push(base);
        }
        continue;
      }

      if (c.status === "ANNULLATO") {
        reasons.hidden_annullato++;
        reasons.hidden_ko_status++;
        if (samples.ko_status.length < 40) {
          samples.ko_status.push(base);
        }
        continue;
      }
      if (c.status === "CHIUSO") {
        reasons.hidden_chiuso++;
        reasons.hidden_ko_status++;
        if (samples.ko_status.length < 40) {
          samples.ko_status.push(base);
        }
        continue;
      }
      if (c.status === "KO") {
        reasons.hidden_ko_status++;
        if (samples.ko_status.length < 40) {
          samples.ko_status.push(base);
        }
        continue;
      }

      // Liquidata is visible in default (not in KO) — counted above
      // Any other unexpected
      if (samples.ko_status.length < 40) {
        samples.ko_status.push({ ...base, note: "unexpected_hidden" });
      }
    }
    if (page.length < pageSize) break;
  }

  // Contratti deletedAt=null isHistorical=true con status «operativo»
  const historicalActive = await prisma.contract.count({
    where: {
      deletedAt: null,
      isHistorical: true,
      status: { notIn: ["KO", "ANNULLATO", "CHIUSO"] },
    },
  });

  // Senza commission, deletedAt null
  const noCommissionActive = await prisma.contract.count({
    where: {
      deletedAt: null,
      commission: null,
    },
  });

  // Restored stubs still active
  const restoredStillActive = await prisma.contract.count({
    where: {
      id: { in: [...restoredIds] },
      deletedAt: null,
    },
  });

  const payload = {
    total,
    scanned,
    visibleDefault,
    prismaDefaultWhereCount: visibleDefault,
    reasons,
    historicalActiveNonKo: historicalActive,
    noCommissionActive,
    restoredStillActive,
    cleanupSoftDeletedRemaining: reasons.hidden_deletedAt_compara_cleanup,
    samples,
  };
  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    total,
    scanned,
    visibleDefault,
    reasons,
    historicalActiveNonKo: historicalActive,
    noCommissionActive,
    restoredStillActive,
  }, null, 2));
  console.log(`JSON → ${OUT}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
