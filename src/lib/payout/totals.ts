import "server-only";

/**
 * Totali per collaboratore di un ciclo di liquidazione.
 *
 * I totali sono calcolati sul momento da righe importate + rettifiche, non
 * memorizzati: restano coerenti anche dopo una riapertura del ciclo. Vengono
 * congelati soltanto quando si genera una versione di report
 * (`PayoutReportItem.snapshotJson`), così il documento è riproducibile identico.
 */

import { prisma } from "@/lib/prisma";
import { decimalToNumber } from "@/lib/commission";
import type { Prisma } from "@/generated/prisma/client";

export type PayoutSnapshotRow = {
  clientName: string;
  podPdr: string;
  supplierName: string;
  contractNumber: string;
  period: string;
  amount: number;
  sourceName: string;
  note: string;
};

export type PayoutSnapshotAdjustment = {
  kind: string;
  amount: number;
  note: string;
  authorName: string;
  createdAt: string;
};

/** Contenuto congelato di un report: basta per rigenerare PDF ed Excel. */
export type PayoutReportSnapshot = {
  runLabel: string;
  period: string;
  version: number;
  collaboratorName: string;
  generatedAt: string;
  rows: PayoutSnapshotRow[];
  adjustments: PayoutSnapshotAdjustment[];
  importedTotal: number;
  adjustmentsTotal: number;
  netTotal: number;
};

export type PayoutCollaboratorTotal = {
  collaboratorId: string;
  collaboratorName: string;
  collaboratorEmail: string;
  rowCount: number;
  importedTotal: number;
  adjustmentsTotal: number;
  netTotal: number;
  /** Righe applicate ai contratti, sottoinsieme di rowCount */
  appliedCount: number;
};

/**
 * Righe del ciclo che contano nei totali: quelle con un collaboratore
 * riconosciuto e un importo. Le ambigue e le non trovate restano fuori dai
 * totali fino alla risoluzione, ed è la scelta corretta: non si liquida ciò che
 * non è stato attribuito.
 */
function countableRowWhere(runId: string): Prisma.PayoutRowWhereInput {
  return {
    batch: { runId, status: { not: "REVERTED" } },
    collaboratorId: { not: null },
    matchStatus: { in: ["MATCHED", "APPLIED"] },
  };
}

export async function loadPayoutRunTotals(
  runId: string,
  /** Filtro di visibilità sui contratti, per i ruoli con perimetro ridotto */
  visibility?: Prisma.ContractWhereInput,
): Promise<PayoutCollaboratorTotal[]> {
  const rowWhere: Prisma.PayoutRowWhereInput = {
    ...countableRowWhere(runId),
    ...(visibility && Object.keys(visibility).length > 0
      ? { contract: visibility }
      : {}),
  };

  const [rows, adjustments] = await Promise.all([
    prisma.payoutRow.findMany({
      where: rowWhere,
      select: {
        collaboratorId: true,
        amount: true,
        appliedAt: true,
        collaborator: { select: { name: true, email: true } },
      },
    }),
    prisma.payoutAdjustment.findMany({
      where: { runId, voidedAt: null },
      select: {
        collaboratorId: true,
        amount: true,
        collaborator: { select: { name: true, email: true } },
      },
    }),
  ]);

  const byCollaborator = new Map<string, PayoutCollaboratorTotal>();
  const ensure = (
    id: string,
    name: string,
    email: string,
  ): PayoutCollaboratorTotal => {
    const found = byCollaborator.get(id);
    if (found) return found;
    const created: PayoutCollaboratorTotal = {
      collaboratorId: id,
      collaboratorName: name,
      collaboratorEmail: email,
      rowCount: 0,
      importedTotal: 0,
      adjustmentsTotal: 0,
      netTotal: 0,
      appliedCount: 0,
    };
    byCollaborator.set(id, created);
    return created;
  };

  for (const row of rows) {
    if (!row.collaboratorId) continue;
    const entry = ensure(
      row.collaboratorId,
      row.collaborator?.name ?? "—",
      row.collaborator?.email ?? "",
    );
    entry.rowCount += 1;
    entry.importedTotal += decimalToNumber(row.amount);
    if (row.appliedAt) entry.appliedCount += 1;
  }

  const visibleIds = new Set(byCollaborator.keys());
  for (const adj of adjustments) {
    // Con visibilità ridotta, le rettifiche seguono i collaboratori visibili
    if (visibility && Object.keys(visibility).length > 0 && !visibleIds.has(adj.collaboratorId)) {
      continue;
    }
    const entry = ensure(
      adj.collaboratorId,
      adj.collaborator.name,
      adj.collaborator.email,
    );
    entry.adjustmentsTotal += decimalToNumber(adj.amount);
  }

  for (const entry of byCollaborator.values()) {
    entry.importedTotal = round2(entry.importedTotal);
    entry.adjustmentsTotal = round2(entry.adjustmentsTotal);
    entry.netTotal = round2(entry.importedTotal + entry.adjustmentsTotal);
  }

  return [...byCollaborator.values()].sort((a, b) =>
    a.collaboratorName.localeCompare(b.collaboratorName, "it"),
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Costruisce lo snapshot congelato del report di un collaboratore. */
export async function buildPayoutSnapshot(params: {
  runId: string;
  collaboratorId: string;
  version: number;
}): Promise<PayoutReportSnapshot> {
  const [run, rows, adjustments, collaborator] = await Promise.all([
    prisma.payoutRun.findUniqueOrThrow({
      where: { id: params.runId },
      select: { label: true, period: true },
    }),
    prisma.payoutRow.findMany({
      where: {
        ...countableRowWhere(params.runId),
        collaboratorId: params.collaboratorId,
      },
      select: {
        amount: true,
        period: true,
        podKey: true,
        podRaw: true,
        note: true,
        contract: {
          select: {
            contractNumber: true,
            podPdr: true,
            pod: true,
            pdr: true,
            supplier: { select: { name: true } },
            client: {
              select: {
                type: true,
                firstName: true,
                lastName: true,
                companyName: true,
              },
            },
          },
        },
        batch: { select: { source: { select: { name: true } } } },
      },
      orderBy: [{ period: "asc" }, { id: "asc" }],
    }),
    prisma.payoutAdjustment.findMany({
      where: {
        runId: params.runId,
        collaboratorId: params.collaboratorId,
        voidedAt: null,
      },
      select: {
        kind: true,
        amount: true,
        note: true,
        createdAt: true,
        createdBy: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: params.collaboratorId },
      select: { name: true },
    }),
  ]);

  const { clientDisplayName } = await import("@/lib/utils");

  const snapshotRows: PayoutSnapshotRow[] = rows.map((row) => ({
    clientName: row.contract ? clientDisplayName(row.contract.client) : "—",
    podPdr:
      row.contract?.podPdr ||
      row.contract?.pod ||
      row.contract?.pdr ||
      row.podKey ||
      row.podRaw ||
      "",
    supplierName: row.contract?.supplier.name ?? "—",
    contractNumber: row.contract?.contractNumber ?? "",
    period: row.period ?? "",
    amount: decimalToNumber(row.amount),
    sourceName: row.batch.source.name,
    note: row.note ?? "",
  }));

  const snapshotAdjustments: PayoutSnapshotAdjustment[] = adjustments.map(
    (adj) => ({
      kind: adj.kind,
      amount: decimalToNumber(adj.amount),
      note: adj.note,
      authorName: adj.createdBy.name,
      createdAt: adj.createdAt.toISOString(),
    }),
  );

  const importedTotal = round2(
    snapshotRows.reduce((sum, r) => sum + r.amount, 0),
  );
  const adjustmentsTotal = round2(
    snapshotAdjustments.reduce((sum, a) => sum + a.amount, 0),
  );

  return {
    runLabel: run.label,
    period: run.period,
    version: params.version,
    collaboratorName: collaborator.name,
    generatedAt: new Date().toISOString(),
    rows: snapshotRows,
    adjustments: snapshotAdjustments,
    importedTotal,
    adjustmentsTotal,
    netTotal: round2(importedTotal + adjustmentsTotal),
  };
}

/** Rilegge uno snapshot salvato. */
export function parsePayoutSnapshot(
  json: string,
): PayoutReportSnapshot | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed != null && typeof parsed === "object" && "rows" in parsed) {
      return parsed as PayoutReportSnapshot;
    }
  } catch {
    return null;
  }
  return null;
}
