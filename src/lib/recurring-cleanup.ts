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
import { periodLabel } from "@/lib/recurring";
import {
  isDisposableRecurringMonth,
  isPeriodInRecurringWindow,
  outOfWindowReason,
  recurringWindow,
} from "@/lib/recurring-window";

/** Contratti esaminati per ogni giro di analisi (limite durata su Vercel). */
export const CLEANUP_SCAN_BATCH = 150;
/** Contratti bonificati per ogni chiamata di applicazione. */
export const CLEANUP_APPLY_BATCH = 50;

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

/**
 * Applica la bonifica ai contratti indicati: ricalcola l'intervallo sul
 * momento (niente fiducia negli id arrivati dal client) ed elimina solo le
 * rate fuori intervallo prive di valore economico.
 * Idempotente: rieseguirla sugli stessi contratti non rimuove altro.
 */
export async function cleanupRecurringOutOfRange(
  contractIds: string[],
): Promise<{ deleted: number; manualReview: number; contracts: number }> {
  if (contractIds.length === 0) {
    return { deleted: 0, manualReview: 0, contracts: 0 };
  }

  const contracts = (await prisma.contract.findMany({
    where: { id: { in: contractIds }, deletedAt: null },
    select: CONTRACT_SELECT,
  })) as ContractWithMonths[];

  const now = new Date();
  const ids: string[] = [];
  let manualReview = 0;

  for (const contract of contracts) {
    const finding = findOutOfWindowMonths(contract, now);
    if (!finding) continue;
    ids.push(...finding.removable.map((row) => row.id));
    manualReview += finding.manual.length;
  }

  let deleted = 0;
  // Niente transazioni con l'adapter Neon HTTP: deleteMany a lotti.
  for (let offset = 0; offset < ids.length; offset += DELETE_CHUNK) {
    const res = await prisma.recurringMonth.deleteMany({
      where: { id: { in: ids.slice(offset, offset + DELETE_CHUNK) } },
    });
    deleted += res.count;
  }

  return { deleted, manualReview, contracts: contracts.length };
}
