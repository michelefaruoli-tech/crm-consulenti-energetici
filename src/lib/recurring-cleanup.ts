/**
 * Bonifica dei mesi ricorrenti fuori dall'intervallo di fornitura.
 *
 * Logica condivisa tra il pulsante nel CRM (pagina Backup e sicurezza) e lo
 * script da riga di comando `scripts/cleanup-recurring-out-of-range.ts`:
 * i due percorsi chiamano queste stesse funzioni, così non possono divergere.
 *
 * Regola di intervallo: vedi `src/lib/recurring-window.ts`.
 * Sicurezza: si rimuovono solo le rate prive di valore economico; quelle
 * incassate / pagate / segnalate restano e vengono elencate a parte.
 * Nessuna transazione (adapter Neon HTTP): solo `deleteMany` a lotti.
 */
import { prisma } from "@/lib/prisma";
import { isAnnualNextHidden, periodLabel } from "@/lib/recurring";
import {
  isDisposableRecurringMonth,
  isPeriodInRecurringWindow,
  outOfWindowReason,
  recurringWindow,
} from "@/lib/recurring-window";

/** Contratti esaminati per ogni giro di analisi (limite durata su Vercel). */
export const CLEANUP_SCAN_BATCH = 150;
/** Contratti bonificati per ogni chiamata di applicazione (CLI / tutto il contratto). */
export const CLEANUP_APPLY_BATCH = 50;
/** Rate selezionate per ogni chiamata di applicazione dal pannello CRM. */
export const CLEANUP_APPLY_MONTH_BATCH = 100;

const DELETE_CHUNK = 100;

export type OutOfWindowMonth = {
  id: string;
  period: string;
  periodLabel: string;
  status: string;
  reason: string;
  amount: number | null;
  settledPeriod: string | null;
};

export type ContractCleanupFinding = {
  contractId: string;
  label: string;
  collaboratorName: string;
  windowLabel: string;
  /** Rate rimovibili: nessun incasso, nessuna liquidazione. */
  removable: OutOfWindowMonth[];
  /** Rate fuori intervallo da decidere a mano: incassate, pagate o segnalate. */
  manual: OutOfWindowMonth[];
};

export type RecurringCleanupScan = {
  findings: ContractCleanupFinding[];
  scannedContracts: number;
  scannedMonths: number;
  removableCount: number;
  manualCount: number;
  /** Id contratto da cui riprendere l'analisi, null se finita. */
  nextCursor: string | null;
};

const CONTRACT_SELECT = {
  id: true,
  podPdr: true,
  insertionDate: true,
  supplyStartDate: true,
  operationType: true,
  status: true,
  expiryDate: true,
  supplier: { select: { name: true } },
  collaborator: { select: { name: true } },
  client: {
    select: {
      type: true,
      companyName: true,
      firstName: true,
      lastName: true,
    },
  },
  statusHistory: {
    where: { toStatus: "CHIUSO" },
    select: { changedAt: true },
    orderBy: { changedAt: "desc" as const },
    take: 1,
  },
  recurringMonths: {
    select: {
      id: true,
      period: true,
      status: true,
      amount: true,
      paidAt: true,
      settledPeriod: true,
      note: true,
    },
    orderBy: { period: "asc" as const },
  },
} as const;

type ContractWithMonths = {
  id: string;
  podPdr: string | null;
  insertionDate: Date | null;
  supplyStartDate: Date | null;
  operationType: string | null;
  status: string | null;
  expiryDate: Date | null;
  supplier: { name: string } | null;
  collaborator: { name: string } | null;
  client: {
    type: string;
    companyName: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
  statusHistory: Array<{ changedAt: Date }>;
  recurringMonths: Array<{
    id: string;
    period: string;
    status: string;
    amount: unknown;
    paidAt: Date | null;
    settledPeriod: string | null;
    note: string | null;
  }>;
};

function contractLabel(contract: ContractWithMonths): string {
  const client = contract.client;
  const name =
    client?.type === "AZIENDA"
      ? (client.companyName ?? "—")
      : [client?.firstName, client?.lastName].filter(Boolean).join(" ") || "—";
  return `${name} · ${contract.supplier?.name ?? "—"} · POD ${contract.podPdr ?? "—"}`;
}

/** Analizza un contratto già caricato, senza toccare il database. */
export function findOutOfWindowMonths(
  contract: ContractWithMonths,
  now: Date = new Date(),
): ContractCleanupFinding | null {
  const window = recurringWindow(contract, now);
  const removable: OutOfWindowMonth[] = [];
  const manual: OutOfWindowMonth[] = [];

  for (const month of contract.recurringMonths) {
    if (isPeriodInRecurringWindow(window, month.period)) continue;
    if (isAnnualNextHidden(month.note)) continue;
    const row: OutOfWindowMonth = {
      id: month.id,
      period: month.period,
      periodLabel: periodLabel(month.period),
      status: month.status,
      reason: outOfWindowReason(window, month.period) ?? "fuori intervallo",
      amount: month.amount == null ? null : Number(String(month.amount)),
      settledPeriod: month.settledPeriod,
    };
    if (isDisposableRecurringMonth(month)) removable.push(row);
    else manual.push(row);
  }

  if (removable.length === 0 && manual.length === 0) return null;

  return {
    contractId: contract.id,
    label: contractLabel(contract),
    collaboratorName: contract.collaborator?.name ?? "—",
    windowLabel: `${periodLabel(window.start)} → ${
      window.end ? periodLabel(window.end) : "aperto"
    }`,
    removable,
    manual,
  };
}

/**
 * Anteprima a lotti: analizza `batchSize` contratti a partire da `cursor`.
 * Non scrive nulla. Richiamare finché `nextCursor` non è null.
 */
export async function scanRecurringOutOfRange(opts?: {
  cursor?: string | null;
  batchSize?: number;
  contractId?: string | null;
}): Promise<RecurringCleanupScan> {
  const batchSize = opts?.batchSize ?? CLEANUP_SCAN_BATCH;
  const cursor = opts?.cursor ?? null;

  const contracts = (await prisma.contract.findMany({
    where: {
      ...(opts?.contractId ? { id: opts.contractId } : {}),
      deletedAt: null,
      recurringMonths: { some: {} },
    },
    select: CONTRACT_SELECT,
    orderBy: { id: "asc" },
    take: batchSize,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })) as ContractWithMonths[];

  const now = new Date();
  const findings: ContractCleanupFinding[] = [];
  let scannedMonths = 0;
  let removableCount = 0;
  let manualCount = 0;

  for (const contract of contracts) {
    scannedMonths += contract.recurringMonths.length;
    const finding = findOutOfWindowMonths(contract, now);
    if (!finding) continue;
    findings.push(finding);
    removableCount += finding.removable.length;
    manualCount += finding.manual.length;
  }

  return {
    findings,
    scannedContracts: contracts.length,
    scannedMonths,
    removableCount,
    manualCount,
    nextCursor:
      contracts.length === batchSize ? (contracts.at(-1)?.id ?? null) : null,
  };
}

export type RecurringCleanupApplyResult = {
  deleted: number;
  manualReview: number;
  contracts: number;
  monthIds: string[];
};

export type ManualOutOfWindowApplyRowResult = {
  monthId: string;
  period: string;
  outcome: "eliminata" | "saltata";
  motivo?: string;
};

function manualOutOfWindowIdsByMonthId(
  contracts: ContractWithMonths[],
  now: Date,
): Map<string, { period: string; reason: string }> {
  const map = new Map<string, { period: string; reason: string }>();
  for (const contract of contracts) {
    const finding = findOutOfWindowMonths(contract, now);
    if (!finding) continue;
    for (const row of finding.manual) {
      map.set(row.id, { period: row.period, reason: row.reason });
    }
  }
  return map;
}

/**
 * Ricalcola l'intervallo e restituisce solo gli id di rata effettivamente
 * rimovibili tra quelli richiesti. Rifiuta se un id non esiste, non è fuori
 * intervallo o è protetto (incassato / pagato / segnalato).
 */
export function validateRemovableMonthIds(
  contracts: ContractWithMonths[],
  requestedIds: string[],
  now: Date = new Date(),
): string[] {
  const unique = [...new Set(requestedIds.filter(Boolean))];
  if (unique.length === 0) return [];

  const removableById = new Map<string, string>();
  for (const contract of contracts) {
    const finding = findOutOfWindowMonths(contract, now);
    if (!finding) continue;
    for (const row of finding.removable) {
      removableById.set(row.id, contract.id);
    }
  }

  const validated: string[] = [];
  for (const id of unique) {
    if (!removableById.has(id)) {
      throw new Error(
        "Una o più rate selezionate non sono rimovibili: aggiorna l'anteprima e riprova",
      );
    }
    validated.push(id);
  }

  return validated;
}

function collectRemovableIdsFromContracts(
  contracts: ContractWithMonths[],
  now: Date,
): { ids: string[]; manualReview: number } {
  const ids: string[] = [];
  let manualReview = 0;
  for (const contract of contracts) {
    const finding = findOutOfWindowMonths(contract, now);
    if (!finding) continue;
    ids.push(...finding.removable.map((row) => row.id));
    manualReview += finding.manual.length;
  }
  return { ids, manualReview };
}

async function deleteRecurringMonthIds(ids: string[]): Promise<number> {
  let deleted = 0;
  for (let offset = 0; offset < ids.length; offset += DELETE_CHUNK) {
    const res = await prisma.recurringMonth.deleteMany({
      where: { id: { in: ids.slice(offset, offset + DELETE_CHUNK) } },
    });
    deleted += res.count;
  }
  return deleted;
}

/**
 * Applica la bonifica ai contratti indicati: ricalcola l'intervallo sul
 * momento ed elimina solo le rate fuori intervallo prive di valore economico.
 * Con `onlyMonthIds` elimina solo le rate validate (pannello CRM).
 * Idempotente: rieseguirla sugli stessi input non rimuove altro.
 */
/**
 * Elimina solo le rate fuori intervallo **con incasso/rendiconto** presenti
 * nell'anteprima (`manual`). Ri-verifica ogni id prima di cancellare: non tocca
 * rate in intervallo, senza incasso (quelle usano `cleanupRecurringOutOfRange`
 * sulla lista `removable`) né id non richiesti.
 */
export async function applyManualOutOfWindowMonthIds(
  monthIds: string[],
): Promise<{ deleted: number; rowResults: ManualOutOfWindowApplyRowResult[] }> {
  const unique = [...new Set(monthIds.filter(Boolean))];
  if (unique.length === 0) {
    return { deleted: 0, rowResults: [] };
  }

  const rows = await prisma.recurringMonth.findMany({
    where: { id: { in: unique } },
    select: { id: true, contractId: true, period: true },
  });
  const rowsById = new Map(rows.map((r) => [r.id, r]));
  const contractIds = [...new Set(rows.map((r) => r.contractId))];
  const contracts =
    contractIds.length > 0
      ? ((await prisma.contract.findMany({
          where: { id: { in: contractIds }, deletedAt: null },
          select: CONTRACT_SELECT,
        })) as ContractWithMonths[])
      : [];

  const now = new Date();
  const manualEligible = manualOutOfWindowIdsByMonthId(contracts, now);
  const rowResults: ManualOutOfWindowApplyRowResult[] = [];
  let deleted = 0;

  for (const monthId of unique) {
    const row = rowsById.get(monthId);
    if (!row) {
      rowResults.push({
        monthId,
        period: "—",
        outcome: "saltata",
        motivo: "Rata non trovata",
      });
      continue;
    }
    if (!manualEligible.has(monthId)) {
      rowResults.push({
        monthId,
        period: row.period,
        outcome: "saltata",
        motivo:
          "Non è più nell'elenco fuori intervallo con incasso (riesegui l'analisi)",
      });
      continue;
    }
    try {
      await prisma.recurringMonth.delete({ where: { id: monthId } });
      deleted += 1;
      rowResults.push({
        monthId,
        period: row.period,
        outcome: "eliminata",
        motivo: manualEligible.get(monthId)?.reason,
      });
    } catch {
      rowResults.push({
        monthId,
        period: row.period,
        outcome: "saltata",
        motivo: "Eliminazione non riuscita",
      });
    }
  }

  return { deleted, rowResults };
}

export async function cleanupRecurringOutOfRange(
  contractIds: string[],
  opts?: { onlyMonthIds?: string[] },
): Promise<RecurringCleanupApplyResult> {
  const onlyMonthIds = opts?.onlyMonthIds?.filter(Boolean) ?? [];
  const now = new Date();

  if (onlyMonthIds.length > 0) {
    const months = await prisma.recurringMonth.findMany({
      where: { id: { in: onlyMonthIds } },
      select: { id: true, contractId: true },
    });
    if (months.length !== new Set(onlyMonthIds).size) {
      throw new Error(
        "Una o più rate selezionate non esistono più: aggiorna l'anteprima e riprova",
      );
    }

    const contractIdSet = new Set(months.map((m) => m.contractId));
    const contracts = (await prisma.contract.findMany({
      where: { id: { in: [...contractIdSet] }, deletedAt: null },
      select: CONTRACT_SELECT,
    })) as ContractWithMonths[];

    const validated = validateRemovableMonthIds(contracts, onlyMonthIds, now);
    const deleted = await deleteRecurringMonthIds(validated);

    return {
      deleted,
      manualReview: 0,
      contracts: contractIdSet.size,
      monthIds: validated,
    };
  }

  if (contractIds.length === 0) {
    return { deleted: 0, manualReview: 0, contracts: 0, monthIds: [] };
  }

  const contracts = (await prisma.contract.findMany({
    where: { id: { in: contractIds }, deletedAt: null },
    select: CONTRACT_SELECT,
  })) as ContractWithMonths[];

  const { ids, manualReview } = collectRemovableIdsFromContracts(contracts, now);
  const deleted = await deleteRecurringMonthIds(ids);

  return {
    deleted,
    manualReview,
    contracts: contracts.length,
    monthIds: ids,
  };
}
