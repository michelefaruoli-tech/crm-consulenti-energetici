/**
 * Ripristina stub Compara soft-delete oggi (compara_duplicate_cleanup)
 * quando non c'è già una riga attiva visibile come «Incassato da liquidare»
 * per stesso nominativo+fornitore.
 *
 * DRY-RUN: npx tsx scripts/restore-compara-stubs.ts
 * APPLY:   APPLY=1 npx tsx scripts/restore-compara-stubs.ts
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
import { classifyComparaSupplier } from "../src/lib/compara-agosto/amounts";
import { fuzzyPersonKey } from "../src/lib/payout/normalize";
import { clientDisplayName } from "../src/lib/utils";

const APPLY = process.env.APPLY === "1";
const OUT =
  process.env.RESTORE_OUT ||
  "/opt/cursor/artifacts/compara-stubs-restore.json";

const KO_OR_HIDDEN = new Set([
  "ANNULLATO",
  "KO",
  "CHIUSO",
  "STORNATO",
  "DA_CONTROLLARE",
  "IN_ATTESA_PAGAMENTO",
  "PROVVIGIONE_LIQUIDATA",
]);

const PROTECTED_KEYS = new Set(
  [
    "DI LALLA FRANCESCA",
    "COLUCCI FRANCESCA ROMANA",
    "VERITA VERONICA",
  ].flatMap((n) => personKeys(n)),
);

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

function canonicalPersonKey(name: string): string {
  const keys = personKeys(name).sort();
  return keys[0] ?? fuzzyPersonKey(name);
}

function supplierKind(name: string | null | undefined): string {
  return classifyComparaSupplier(name ?? "");
}

/** Visibile in Provvigioni come Incassato da liquidare (filtro Incassato). */
function isIncassatoVisible(c: {
  deletedAt: Date | null;
  isHistorical: boolean;
  status: string;
  collectionDate: Date | null;
}): boolean {
  if (c.deletedAt) return false;
  if (c.isHistorical) return false;
  if (KO_OR_HIDDEN.has(c.status)) return false;
  if (c.status === "PAGATO_DAL_FORNITORE") return true;
  return c.collectionDate != null;
}

type StubRow = {
  id: string;
  contractNumber: string;
  status: string;
  deletedAt: Date | null;
  isHistorical: boolean;
  collectionDate: Date | null;
  clientId: string;
  clientName: string;
  clientDeletedAt: Date | null;
  supplierName: string;
  collaboratorName: string | null;
  productName: string | null;
  previousStatus: string;
  personKey: string;
  supplierKind: string;
};

async function loadCleanupStubs(): Promise<StubRow[]> {
  const audits = await prisma.auditLog.findMany({
    where: {
      action: "SOFT_DELETE",
      entity: "Contract",
      details: { contains: "compara_duplicate_cleanup" },
    },
    orderBy: { createdAt: "desc" },
    select: { entityId: true, details: true },
  });

  const byId = new Map<string, { previousStatus: string }>();
  for (const a of audits) {
    if (byId.has(a.entityId)) continue;
    let previousStatus = "PAGATO_DAL_FORNITORE";
    try {
      const d = JSON.parse(a.details ?? "{}") as {
        previousStatus?: string;
        reason?: string;
      };
      if (d.reason && d.reason !== "compara_duplicate_cleanup") continue;
      if (d.previousStatus && d.previousStatus !== "ANNULLATO") {
        previousStatus = d.previousStatus;
      }
    } catch {
      /* keep default */
    }
    byId.set(a.entityId, { previousStatus });
  }

  const ids = [...byId.keys()];
  if (ids.length === 0) return [];

  const contracts = await prisma.contract.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      contractNumber: true,
      status: true,
      deletedAt: true,
      isHistorical: true,
      collectionDate: true,
      productName: true,
      clientId: true,
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
    },
  });

  return contracts.map((c) => {
    const clientName = clientDisplayName(c.client);
    return {
      id: c.id,
      contractNumber: c.contractNumber,
      status: c.status,
      deletedAt: c.deletedAt,
      isHistorical: c.isHistorical,
      collectionDate: c.collectionDate,
      clientId: c.clientId,
      clientName,
      clientDeletedAt: c.client.deletedAt,
      supplierName: c.supplier?.name ?? "",
      collaboratorName: c.collaborator?.name ?? null,
      productName: c.productName,
      previousStatus: byId.get(c.id)?.previousStatus ?? "PAGATO_DAL_FORNITORE",
      personKey: canonicalPersonKey(clientName),
      supplierKind: supplierKind(c.supplier?.name),
    };
  });
}

async function findVisibleIncassato(
  personKey: string,
  kind: string,
  excludeIds: Set<string>,
): Promise<
  Array<{
    id: string;
    contractNumber: string;
    status: string;
    clientName: string;
    supplierName: string;
  }>
> {
  // Carica candidati non cancellati non storici, filtra in TS per nome/fornitore
  const candidates = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      isHistorical: false,
      status: { notIn: ["ANNULLATO", "KO", "CHIUSO"] },
      id: { notIn: [...excludeIds] },
    },
    select: {
      id: true,
      contractNumber: true,
      status: true,
      collectionDate: true,
      isHistorical: true,
      deletedAt: true,
      client: {
        select: {
          firstName: true,
          lastName: true,
          companyName: true,
          type: true,
        },
      },
      supplier: { select: { name: true } },
    },
  });

  const keys = new Set(personKeys(personKey));
  // personKey is already canonical; also expand
  for (const k of personKeys(personKey)) keys.add(k);

  return candidates
    .filter((c) => {
      const name = clientDisplayName(c.client);
      const nameKeys = personKeys(name);
      if (!nameKeys.some((k) => keys.has(k) || personKeys(personKey).includes(k))) {
        // Match if any key overlaps
        const overlap = nameKeys.some((k) =>
          personKeys(personKey).includes(k),
        );
        if (!overlap) return false;
      }
      if (supplierKind(c.supplier?.name) !== kind) return false;
      return isIncassatoVisible(c);
    })
    .map((c) => ({
      id: c.id,
      contractNumber: c.contractNumber,
      status: c.status,
      clientName: clientDisplayName(c.client),
      supplierName: c.supplier?.name ?? "",
    }));
}

async function findContractsByNames(
  names: string[],
): Promise<
  Array<{
    id: string;
    contractNumber: string;
    status: string;
    deletedAt: Date | null;
    isHistorical: boolean;
    collectionDate: Date | null;
    clientName: string;
    clientDeletedAt: Date | null;
    clientId: string;
    supplierName: string;
    collaboratorName: string | null;
    personKey: string;
    supplierKind: string;
  }>
> {
  const all = await prisma.contract.findMany({
    where: { isHistorical: false },
    select: {
      id: true,
      contractNumber: true,
      status: true,
      deletedAt: true,
      isHistorical: true,
      collectionDate: true,
      clientId: true,
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
    },
  });

  const want = new Set(names.flatMap((n) => personKeys(n)));
  return all
    .filter((c) => {
      const name = clientDisplayName(c.client);
      return personKeys(name).some((k) => want.has(k));
    })
    .map((c) => {
      const clientName = clientDisplayName(c.client);
      return {
        id: c.id,
        contractNumber: c.contractNumber,
        status: c.status,
        deletedAt: c.deletedAt,
        isHistorical: c.isHistorical,
        collectionDate: c.collectionDate,
        clientName,
        clientDeletedAt: c.client.deletedAt,
        clientId: c.clientId,
        supplierName: c.supplier?.name ?? "",
        collaboratorName: c.collaborator?.name ?? null,
        personKey: canonicalPersonKey(clientName),
        supplierKind: supplierKind(c.supplier?.name),
      };
    });
}

async function main() {
  const stubs = await loadCleanupStubs();
  const stubIds = new Set(stubs.map((s) => s.id));

  type Decision =
    | {
        action: "restore";
        stub: StubRow;
        reason: string;
      }
    | {
        action: "already_ok";
        stub: StubRow;
        visible: Array<{ contractNumber: string; status: string }>;
        reason: string;
      }
    | {
        action: "skip_protected";
        stub: StubRow;
        reason: string;
      }
    | {
        action: "skip_not_deleted";
        stub: StubRow;
        reason: string;
      };

  const decisions: Decision[] = [];

  // Precompute visible Incassato per gruppo (escludendo tutti gli stub cleanup)
  const groupKeys = new Map<string, StubRow[]>();
  for (const s of stubs) {
    const gk = `${s.personKey}::${s.supplierKind}`;
    const list = groupKeys.get(gk) ?? [];
    list.push(s);
    groupKeys.set(gk, list);
  }

  const visibleByGroup = new Map<
    string,
    Awaited<ReturnType<typeof findVisibleIncassato>>
  >();
  for (const [gk, list] of groupKeys) {
    const sample = list[0]!;
    const visible = await findVisibleIncassato(
      sample.personKey,
      sample.supplierKind,
      stubIds,
    );
    visibleByGroup.set(gk, visible);
  }

  for (const stub of stubs) {
    const gk = `${stub.personKey}::${stub.supplierKind}`;
    if (PROTECTED_KEYS.has(stub.personKey) || personKeys(stub.clientName).some((k) => PROTECTED_KEYS.has(k))) {
      decisions.push({
        action: "skip_protected",
        stub,
        reason: "Nominativo protetto (Di Lalla / Colucci / Verita)",
      });
      continue;
    }
    if (!stub.deletedAt) {
      decisions.push({
        action: "skip_not_deleted",
        stub,
        reason: `Già attivo (status=${stub.status})`,
      });
      continue;
    }
    const visible = visibleByGroup.get(gk) ?? [];
    if (visible.length > 0) {
      decisions.push({
        action: "already_ok",
        stub,
        visible: visible.map((v) => ({
          contractNumber: v.contractNumber,
          status: v.status,
        })),
        reason: `Già presente Incassato: ${visible.map((v) => v.contractNumber).join(", ")}`,
      });
      continue;
    }
    decisions.push({
      action: "restore",
      stub,
      reason: `Nessuna riga Incassato attiva per ${stub.clientName}/${stub.supplierKind}; ripristina stub (era ${stub.previousStatus})`,
    });
  }

  // Extra: Ogbe, Vitucci, Benedetto — visibilità senza stub cleanup
  const extras = await findContractsByNames([
    "OGBE GREAT",
    "GREAT OGBE",
    "VITUCCI GIANLUCA",
    "GIANLUCA VITUCCI",
    "BENEDETTO ROSANNA",
    "ROSANNA BENEDETTO",
  ]);

  type ExtraDecision = {
    action: "fix_status_to_incassato" | "already_incassato" | "note";
    id: string;
    contractNumber: string;
    clientName: string;
    supplierName: string;
    fromStatus: string;
    reason: string;
  };
  const extraDecisions: ExtraDecision[] = [];

  // Ogbe Plenitude
  const ogbeRows = extras.filter(
    (c) =>
      personKeys(c.clientName).some((k) =>
        personKeys("OGBE GREAT").includes(k),
      ) &&
      c.supplierKind === "eni" &&
      !c.deletedAt,
  );
  const ogbeIncassato = ogbeRows.filter((c) => isIncassatoVisible(c));
  if (ogbeIncassato.length > 0) {
    for (const c of ogbeIncassato) {
      extraDecisions.push({
        action: "already_incassato",
        id: c.id,
        contractNumber: c.contractNumber,
        clientName: c.clientName,
        supplierName: c.supplierName,
        fromStatus: c.status,
        reason: "Già visibile come Incassato da liquidare",
      });
    }
  } else {
    // Prefer Compara stub number 003116 or any liquidated with collectionDate
    const target =
      ogbeRows.find((c) => c.contractNumber === "CTR-2026-003116") ??
      ogbeRows.find(
        (c) => c.status === "PROVVIGIONE_LIQUIDATA" && c.collectionDate,
      );
    if (target) {
      extraDecisions.push({
        action: "fix_status_to_incassato",
        id: target.id,
        contractNumber: target.contractNumber,
        clientName: target.clientName,
        supplierName: target.supplierName,
        fromStatus: target.status,
        reason:
          "Stub Compara tenuto ma Liquidato → rimetti PAGATO_DAL_FORNITORE (Incassato da liquidare)",
      });
    } else {
      extraDecisions.push({
        action: "note",
        id: "",
        contractNumber: "-",
        clientName: "OGBE GREAT",
        supplierName: "Plenitude/Eni",
        fromStatus: "-",
        reason: "Nessun contratto Eni/Plenitude attivo trovato da sistemare",
      });
    }
  }

  // Vitucci Gianluca Plenitude/Eni
  const vitucciRows = extras.filter(
    (c) =>
      personKeys(c.clientName).some((k) =>
        personKeys("VITUCCI GIANLUCA").includes(k),
      ) &&
      c.supplierKind === "eni" &&
      !c.deletedAt,
  );
  const vitucciInc = vitucciRows.filter((c) => isIncassatoVisible(c));
  if (vitucciInc.length > 0) {
    for (const c of vitucciInc) {
      extraDecisions.push({
        action: "already_incassato",
        id: c.id,
        contractNumber: c.contractNumber,
        clientName: c.clientName,
        supplierName: c.supplierName,
        fromStatus: c.status,
        reason: "Già visibile come Incassato da liquidare",
      });
    }
  } else {
    const target =
      vitucciRows.find(
        (c) => c.status === "PROVVIGIONE_LIQUIDATA" && c.collectionDate,
      ) ?? vitucciRows[0];
    if (target && target.collectionDate) {
      extraDecisions.push({
        action: "fix_status_to_incassato",
        id: target.id,
        contractNumber: target.contractNumber,
        clientName: target.clientName,
        supplierName: target.supplierName,
        fromStatus: target.status,
        reason:
          "Nessuno Incassato attivo: rimetti da Liquidato a PAGATO_DAL_FORNITORE",
      });
    } else {
      extraDecisions.push({
        action: "note",
        id: "",
        contractNumber: "-",
        clientName: "VITUCCI GIANLUCA",
        supplierName: "Eni/Plenitude",
        fromStatus: "-",
        reason: "Nessun contratto Eni da sistemare",
      });
    }
  }

  // Benedetto Rosanna
  const benRows = extras.filter(
    (c) =>
      personKeys(c.clientName).some((k) =>
        personKeys("BENEDETTO ROSANNA").includes(k),
      ) &&
      c.supplierKind === "eni" &&
      !c.deletedAt,
  );
  const benInc = benRows.filter((c) => isIncassatoVisible(c));
  if (benInc.length > 0) {
    for (const c of benInc) {
      extraDecisions.push({
        action: "already_incassato",
        id: c.id,
        contractNumber: c.contractNumber,
        clientName: c.clientName,
        supplierName: c.supplierName,
        fromStatus: c.status,
        reason: "Già PAGATO_DAL_FORNITORE / Incassato da liquidare",
      });
    }
  } else {
    const target = benRows.find((c) => c.collectionDate);
    if (target) {
      extraDecisions.push({
        action: "fix_status_to_incassato",
        id: target.id,
        contractNumber: target.contractNumber,
        clientName: target.clientName,
        supplierName: target.supplierName,
        fromStatus: target.status,
        reason: "Non visibile Incassato: rimetti PAGATO_DAL_FORNITORE",
      });
    } else {
      extraDecisions.push({
        action: "note",
        id: "",
        contractNumber: "-",
        clientName: "BENEDETTO ROSANNA",
        supplierName: "Eni",
        fromStatus: "-",
        reason: "Nessun contratto Eni trovato",
      });
    }
  }

  const toRestore = decisions.filter((d) => d.action === "restore");
  const alreadyOk = decisions.filter((d) => d.action === "already_ok");
  const toFixStatus = extraDecisions.filter(
    (d) => d.action === "fix_status_to_incassato",
  );

  console.log(
    JSON.stringify(
      {
        stubsFromCleanup: stubs.length,
        restore: toRestore.length,
        alreadyOk: alreadyOk.length,
        protected: decisions.filter((d) => d.action === "skip_protected").length,
        notDeleted: decisions.filter((d) => d.action === "skip_not_deleted")
          .length,
        extraFixStatus: toFixStatus.length,
        extraAlready: extraDecisions.filter(
          (d) => d.action === "already_incassato",
        ).length,
        apply: APPLY,
      },
      null,
      2,
    ),
  );

  for (const d of toRestore) {
    if (d.action !== "restore") continue;
    console.log(
      `RESTORE ${d.stub.contractNumber} (${d.stub.id}) ${d.stub.clientName}/${d.stub.supplierName} → ${d.stub.previousStatus} · ${d.reason}`,
    );
  }
  for (const d of alreadyOk) {
    if (d.action !== "already_ok") continue;
    console.log(
      `ALREADY ${d.stub.contractNumber} ${d.stub.clientName} · ${d.reason}`,
    );
  }
  for (const d of extraDecisions) {
    console.log(
      `EXTRA ${d.action} ${d.contractNumber} ${d.clientName}/${d.supplierName} ${d.fromStatus} · ${d.reason}`,
    );
  }

  const applied: Array<Record<string, unknown>> = [];

  if (APPLY) {
    const admin = await prisma.user.findFirst({
      where: { role: "ADMIN", active: true },
      select: { id: true },
    });
    const actorId = admin?.id ?? "compara-restore";

    for (const d of toRestore) {
      if (d.action !== "restore") continue;
      const status = d.stub.previousStatus;
      await prisma.contract.update({
        where: { id: d.stub.id },
        data: {
          deletedAt: null,
          status: status as never,
        },
      });
      let clientRestored = false;
      if (d.stub.clientDeletedAt) {
        await prisma.client.update({
          where: { id: d.stub.clientId },
          data: { deletedAt: null },
        });
        clientRestored = true;
        await prisma.auditLog.create({
          data: {
            userId: actorId,
            action: "RESTORE",
            entity: "Client",
            entityId: d.stub.clientId,
            details: JSON.stringify({
              reason: "compara_stub_restore_orphan_client",
              afterContract: d.stub.id,
            }),
          },
        });
      }
      await prisma.auditLog.create({
        data: {
          userId: actorId,
          action: "RESTORE",
          entity: "Contract",
          entityId: d.stub.id,
          details: JSON.stringify({
            reason: "compara_stub_restore_for_provvigioni",
            restoredStatus: status,
            clientRestored,
          }),
        },
      });
      applied.push({
        type: "restore_stub",
        contractId: d.stub.id,
        contractNumber: d.stub.contractNumber,
        restoredStatus: status,
        clientRestored,
      });
      console.log(
        `APPLIED restore ${d.stub.contractNumber} status=${status} clientRestored=${clientRestored}`,
      );
    }

    for (const d of toFixStatus) {
      await prisma.contract.update({
        where: { id: d.id },
        data: { status: "PAGATO_DAL_FORNITORE" },
      });
      await prisma.auditLog.create({
        data: {
          userId: actorId,
          action: "STATUS_CHANGE",
          entity: "Contract",
          entityId: d.id,
          details: JSON.stringify({
            reason: "compara_visibility_fix_incassato",
            from: d.fromStatus,
            to: "PAGATO_DAL_FORNITORE",
          }),
        },
      });
      applied.push({
        type: "fix_status",
        contractId: d.id,
        contractNumber: d.contractNumber,
        from: d.fromStatus,
        to: "PAGATO_DAL_FORNITORE",
      });
      console.log(
        `APPLIED status ${d.contractNumber} ${d.fromStatus} → PAGATO_DAL_FORNITORE`,
      );
    }
  }

  const payload = {
    apply: APPLY,
    summary: {
      stubsFromCleanup: stubs.length,
      restored: APPLY
        ? applied.filter((a) => a.type === "restore_stub").length
        : toRestore.length,
      alreadyOk: alreadyOk.length,
      statusFixed: APPLY
        ? applied.filter((a) => a.type === "fix_status").length
        : toFixStatus.length,
    },
    toRestore: toRestore.map((d) =>
      d.action === "restore"
        ? {
            id: d.stub.id,
            number: d.stub.contractNumber,
            name: d.stub.clientName,
            supplier: d.stub.supplierName,
            collaborator: d.stub.collaboratorName,
            previousStatus: d.stub.previousStatus,
            reason: d.reason,
          }
        : null,
    ),
    alreadyOk: alreadyOk.map((d) =>
      d.action === "already_ok"
        ? {
            stubNumber: d.stub.contractNumber,
            name: d.stub.clientName,
            visible: d.visible,
            reason: d.reason,
          }
        : null,
    ),
    extras: extraDecisions,
    applied,
  };
  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(`JSON → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
