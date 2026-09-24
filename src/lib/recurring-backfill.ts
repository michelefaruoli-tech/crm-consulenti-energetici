/**
 * Backfill "contratto salvato ma non in Provvigioni".
 *
 * Trova contratti ricorrenti (M/R, qualsiasi fornitore) attivi che non hanno
 * ancora la rata `RecurringMonth` che dovrebbero già avere secondo le stesse
 * regole di finestra/lag usate ovunque nel CRM (`recurring-window.ts`,
 * `helios-contract-rules.ts` — il lag Helios M+2 resta). Crea solo righe
 * assenti: usa `syncRecurringMonthsForContract`, che non tocca mai una rata
 * già presente in stato Incassato / Pagato / Chiuso / Non pagato (vedi
 * `PRESERVED_STATUSES` in `recurring-sync.ts`) — quindi nessuna rata sistemata
 * a mano dall'utente viene sovrascritta.
 *
 * Stessa struttura anteprima → applica di `recurring-cleanup.ts`: l'anteprima
 * non scrive nulla, l'applicazione è idempotente.
 */
import { prisma } from "@/lib/prisma";
import {
  addMonths,
  isRecurringAnnual,
  isRecurringMonthly,
  monthsBetween,
  toPeriod,
} from "@/lib/recurring";
import { lastGeneratedPeriod, recurringWindow } from "@/lib/recurring-window";
import { recurringGenerationLagMonths } from "@/lib/helios-contract-rules";
import {
  recurringAnnualWhereOr,
  recurringMonthlyWhereOr,
} from "@/lib/provvigioni-filters";
import { syncRecurringMonthsForContract } from "@/lib/recurring-sync";

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

export type BackfillApplyResult = {
  contracts: number;
  /** Rate RecurringMonth create (0 se il contratto era già a posto). */
  created: number;
  errors: Array<{ contractId: string; message: string }>;
};

const CANDIDATE_SELECT = {
  id: true,
  podPdr: true,
  pod: true,
  pdr: true,
  recurrence: true,
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
    select: { period: true, status: true },
  },
} as const;

type CandidateContract = {
  id: string;
  podPdr: string | null;
  pod: string | null;
  pdr: string | null;
  recurrence: string | null;
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
  recurringMonths: Array<{ period: string; status: string }>;
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

/**
 * Periodi che dovrebbero già esistere per questo contratto, senza scrivere
 * nulla (usata dall'anteprima e testata senza database in
 * `scripts/check-backfill-provvigioni.ts`).
 */
export function expectedPeriodsFor(
  contract: CandidateContract,
  now: Date,
): string[] {
  if (contract.status === "ANNULLATO" || contract.status === "KO") return [];

  const window = recurringWindow(contract, now);

  if (isRecurringAnnual(contract.recurrence)) {
    if (contract.status === "CHIUSO") return [];
    const nowPeriod = toPeriod(now);
    const paidPeriods = contract.recurringMonths
      .filter((m) => m.status === "PAID" || m.status === "LIQUIDATED")
      .map((m) => m.period)
      .sort((a, b) => b.localeCompare(a));
    let nextDue =
      paidPeriods.length > 0
        ? addMonths(paidPeriods[0]!, 12)
        : addMonths(window.start, 12);
    const due: string[] = [];
    for (let i = 0; i < 10; i++) {
      if (nextDue > nowPeriod) break;
      due.push(nextDue);
      nextDue = addMonths(nextDue, 12);
    }
    return due;
  }

  if (isRecurringMonthly(contract.recurrence)) {
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

/** Esportata solo per il test senza database `scripts/check-backfill-provvigioni.ts`. */
export function findMissing(
  contract: CandidateContract,
  now: Date,
): MissingProvvigioneRow | null {
  const expected = expectedPeriodsFor(contract, now);
  if (expected.length === 0) return null;
  const existing = new Set(contract.recurringMonths.map((m) => m.period));
  const missingPeriods = expected.filter((p) => !existing.has(p));
  if (missingPeriods.length === 0) return null;
  return {
    contractId: contract.id,
    label: contractLabel(contract),
    collaboratorName: contract.collaborator?.name ?? "—",
    supplierName: contract.supplier?.name ?? "—",
    recurrenceKind: isRecurringAnnual(contract.recurrence) ? "R" : "M",
    missingPeriods,
  };
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
 * Applica il backfill: richiama `syncRecurringMonthsForContract` per ogni
 * contratto indicato (stessa funzione usata alla creazione e in ogni altro
 * punto del CRM). Rilegge le rate dopo per contare quelle effettivamente
 * create — idempotente, si può richiamare più volte senza effetti diversi.
 */
export async function applyMissingProvvigioniRows(
  contractIds: string[],
): Promise<BackfillApplyResult> {
  const ids = [...new Set(contractIds.filter(Boolean))];
  let created = 0;
  const errors: Array<{ contractId: string; message: string }> = [];

  for (const contractId of ids) {
    try {
      const before = await prisma.recurringMonth.count({ where: { contractId } });
      await syncRecurringMonthsForContract(contractId);
      const after = await prisma.recurringMonth.count({ where: { contractId } });
      created += Math.max(0, after - before);
    } catch (e) {
      errors.push({
        contractId,
        message: e instanceof Error ? e.message.slice(0, 200) : "Errore",
      });
    }
  }

  return { contracts: ids.length, created, errors };
}
