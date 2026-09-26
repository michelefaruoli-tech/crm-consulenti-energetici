/**
 * Backfill "contratto salvato ma non in Provvigioni".
 *
 * Anteprima e applicazione usano **lo stesso piano** (`planBackfillForContract`):
 * stesse regole di finestra, lag Helios, primo anno annuale e rate auto-chiuse.
 */
import { prisma } from "@/lib/prisma";
import {
  addMonths,
  isContractRecurringAnnual,
  isContractRecurringMonthly,
  monthsBetween,
  nextAnnualDuePeriod,
  toPeriod,
} from "@/lib/recurring";
import {
  isPeriodInRecurringWindow,
  lastGeneratedPeriod,
  periodSatisfiedForBackfill,
  recurringWindow,
} from "@/lib/recurring-window";
import { recurringGenerationLagMonths } from "@/lib/helios-contract-rules";
import {
  recurringAnnualWhereOr,
  recurringMonthlyWhereOr,
} from "@/lib/provvigioni-filters";
import {
  upsertAnnualBackfillPeriod,
  upsertMonthlyBackfillPeriod,
  type BackfillUpsertOutcome,
} from "@/lib/recurring-sync";

/** Contratti esaminati per ogni giro di anteprima (limite durata Vercel). */
export const BACKFILL_SCAN_BATCH = 300;
/** Contratti sincronizzati per ogni chiamata di applicazione. */
export const BACKFILL_APPLY_BATCH = 40;

export type MissingProvvigioneRow = {
  contractId: string;
  label: string;
  collaboratorName: string;
  supplierName: string;
  recurrenceKind: "M" | "R";
  /** Periodi YYYY-MM che dovrebbero già esistere e non ci sono. */
  missingPeriods: string[];
};

export type BackfillScanResult = {
  findings: MissingProvvigioneRow[];
  scannedContracts: number;
  missingContractsCount: number;
  missingPeriodsCount: number;
  /** Id contratto da cui riprendere l'analisi, null se finita. */
  nextCursor: string | null;
};

export type BackfillPeriodRowResult = {
  contractId: string;
  period: string;
  outcome: BackfillUpsertOutcome;
  motivo?: string;
};

export type BackfillApplyResult = {
  contracts: number;
  /** Rate create ex novo. */
  created: number;
  /** Rate riaperte o aggiornate (es. chiusura automatica). */
  updated: number;
  rowResults: BackfillPeriodRowResult[];
  errors: Array<{ contractId: string; message: string }>;
};

export type BackfillPlanItem = {
  period: string;
  recurrenceKind: "M" | "R";
};

const CANDIDATE_SELECT = {
  id: true,
  podPdr: true,
  pod: true,
  pdr: true,
  recurrence: true,
  recurrenceKind: true,
  collectionDate: true,
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
    where: { toStatus: "CHIUSO" as const },
    select: { changedAt: true },
    orderBy: { changedAt: "desc" as const },
    take: 1,
  },
  recurringMonths: {
    select: { period: true, status: true, note: true },
  },
  commission: { select: { expected: true } },
} as const;

export type CandidateContract = {
  id: string;
  podPdr: string | null;
  pod: string | null;
  pdr: string | null;
  recurrence: string | null;
  recurrenceKind: "UT" | "M" | "R";
  collectionDate: Date | null;
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
  recurringMonths: Array<{ period: string; status: string; note?: string | null }>;
  commission?: { expected: unknown } | null;
};

function contractLabel(contract: CandidateContract): string {
  const client = contract.client;
  const name =
    client?.type === "AZIENDA"
      ? client.companyName ?? "—"
      : [client?.firstName, client?.lastName].filter(Boolean).join(" ") || "—";
  const pod = contract.podPdr || contract.pod || contract.pdr || "—";
  return `${name} · ${contract.supplier?.name ?? "—"} · POD/PDR ${pod}`;
}

function annualFirstYearCollected(contract: CandidateContract): boolean {
  if (contract.collectionDate) return true;
  return contract.recurringMonths.some(
    (m) => m.status === "PAID" || m.status === "LIQUIDATED",
  );
}

function expectedAnnualPeriods(contract: CandidateContract, now: Date): string[] {
  if (contract.status === "CHIUSO") return [];
  if (!annualFirstYearCollected(contract)) return [];

  const window = recurringWindow(contract, now);
  const nowPeriod = toPeriod(now);
  const paidPeriods = contract.recurringMonths
    .filter((m) => m.status === "PAID" || m.status === "LIQUIDATED")
    .map((m) => m.period);
  const rowsByPeriod = new Map(contract.recurringMonths.map((m) => [m.period, m]));

  const due: string[] = [];
  let nextDue = nextAnnualDuePeriod(window.start, paidPeriods);
  for (let i = 0; i < 10; i++) {
    if (nextDue > nowPeriod) break;
    const row = rowsByPeriod.get(nextDue);
    if (row && (row.status === "PAID" || row.status === "LIQUIDATED")) {
      nextDue = addMonths(nextDue, 12);
      continue;
    }
    if (!isPeriodInRecurringWindow(window, nextDue)) {
      nextDue = addMonths(nextDue, 12);
      continue;
    }
    due.push(nextDue);
    nextDue = addMonths(nextDue, 12);
  }
  return due;
}

/**
 * Periodi che dovrebbero già esistere per questo contratto (solo lettura).
 */
export function expectedPeriodsFor(
  contract: CandidateContract,
  now: Date,
): string[] {
  if (contract.status === "ANNULLATO" || contract.status === "KO") return [];

  if (isContractRecurringAnnual(contract)) {
    return expectedAnnualPeriods(contract, now);
  }

  if (isContractRecurringMonthly(contract)) {
    const window = recurringWindow(contract, now);
    const lastPeriod = lastGeneratedPeriod(
      window,
      now,
      recurringGenerationLagMonths(contract.supplier?.name),
    );
    if (window.start > lastPeriod) return [];
    return monthsBetween(window.start, lastPeriod);
  }

  return [];
}

/**
 * Piano condiviso anteprima → applica: quali periodi creare o riaprire.
 */
export function planBackfillForContract(
  contract: CandidateContract,
  now: Date = new Date(),
): BackfillPlanItem[] {
  const expected = expectedPeriodsFor(contract, now);
  if (expected.length === 0) return [];

  const rowsByPeriod = new Map(contract.recurringMonths.map((m) => [m.period, m]));
  const kind: "M" | "R" = isContractRecurringAnnual(contract) ? "R" : "M";

  const plan: BackfillPlanItem[] = [];
  for (const period of expected) {
    const row = rowsByPeriod.get(period);
    if (periodSatisfiedForBackfill(row)) continue;
    plan.push({ period, recurrenceKind: kind });
  }
  return plan;
}

/** Esportata per test offline e controllo integrità. */
export function findMissing(
  contract: CandidateContract,
  now: Date,
): MissingProvvigioneRow | null {
  const plan = planBackfillForContract(contract, now);
  if (plan.length === 0) return null;
  const recurrenceKind = plan[0]?.recurrenceKind ?? "M";
  return {
    contractId: contract.id,
    label: contractLabel(contract),
    collaboratorName: contract.collaborator?.name ?? "—",
    supplierName: contract.supplier?.name ?? "—",
    recurrenceKind,
    missingPeriods: plan.map((p) => p.period),
  };
}

export async function applyBackfillPlanForContract(
  contract: CandidateContract,
  now: Date = new Date(),
): Promise<BackfillPeriodRowResult[]> {
  const plan = planBackfillForContract(contract, now);
  const amount = Number(contract.commission?.expected ?? 0) || null;
  const results: BackfillPeriodRowResult[] = [];

  for (const item of plan) {
    const res =
      item.recurrenceKind === "R"
        ? await upsertAnnualBackfillPeriod(contract.id, item.period, amount, now)
        : await upsertMonthlyBackfillPeriod(contract.id, item.period, amount, now);
    results.push({
      contractId: contract.id,
      period: item.period,
      outcome: res.outcome,
      motivo: res.motivo,
    });
  }
  return results;
}

/**
 * Anteprima a lotti: analizza `batchSize` contratti ricorrenti a partire da
 * `cursor`. Non scrive nulla. Richiamare finché `nextCursor` non è null.
 */
export async function scanMissingProvvigioniRows(opts?: {
  cursor?: string | null;
  batchSize?: number;
}): Promise<BackfillScanResult> {
  const batchSize = opts?.batchSize ?? BACKFILL_SCAN_BATCH;
  const cursor = opts?.cursor ?? null;

  const contracts = (await prisma.contract.findMany({
    where: {
      deletedAt: null,
      isHistorical: false,
      OR: [...recurringMonthlyWhereOr, ...recurringAnnualWhereOr],
    },
    select: CANDIDATE_SELECT,
    orderBy: { id: "asc" },
    take: batchSize,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })) as CandidateContract[];

  const now = new Date();
  const findings: MissingProvvigioneRow[] = [];
  let missingPeriodsCount = 0;

  for (const contract of contracts) {
    const finding = findMissing(contract, now);
    if (!finding) continue;
    findings.push(finding);
    missingPeriodsCount += finding.missingPeriods.length;
  }

  return {
    findings,
    scannedContracts: contracts.length,
    missingContractsCount: findings.length,
    missingPeriodsCount,
    nextCursor:
      contracts.length === batchSize ? contracts.at(-1)?.id ?? null : null,
  };
}

/**
 * Applica il piano di backfill (stessa logica dell'anteprima), periodo per periodo.
 */
export async function applyMissingProvvigioniRows(
  contractIds: string[],
): Promise<BackfillApplyResult> {
  const ids = [...new Set(contractIds.filter(Boolean))];
  let created = 0;
  let updated = 0;
  const rowResults: BackfillPeriodRowResult[] = [];
  const errors: Array<{ contractId: string; message: string }> = [];
  const now = new Date();

  for (const contractId of ids) {
    try {
      const contract = (await prisma.contract.findUnique({
        where: { id: contractId },
        select: CANDIDATE_SELECT,
      })) as CandidateContract | null;
      if (!contract) {
        errors.push({ contractId, message: "Contratto non trovato" });
        continue;
      }
      const applied = await applyBackfillPlanForContract(contract, now);
      rowResults.push(...applied);
      for (const row of applied) {
        if (row.outcome === "creata") created += 1;
        if (row.outcome === "aggiornata") updated += 1;
      }
    } catch (e) {
      errors.push({
        contractId,
        message: e instanceof Error ? e.message.slice(0, 200) : "Errore",
      });
    }
  }

  return { contracts: ids.length, created, updated, rowResults, errors };
}
