/**
 * Controllo integrità provvigioni — caricamento dati (Fase 1, solo lettura).
 *
 * Stessa struttura a lotti già usata da `recurring-backfill.ts` e
 * `recurring-cleanup.ts`: analizza `batchSize` contratti a partire da un
 * cursore, non scrive nulla. Riusa quelle stesse funzioni per "righe
 * mancanti" ed "extra fuori intervallo" (già corrette e testate) e aggiunge
 * solo i controlli nuovi (rate in anticipo, repliche non archiviate,
 * duplicati, totali).
 */
import { prisma } from "@/lib/prisma";
import { periodLabel } from "@/lib/recurring";
import { findMissing } from "@/lib/recurring-backfill";
import { findOutOfWindowMonths } from "@/lib/recurring-cleanup";
import {
  compareTotals,
  findDuplicateRecurringPeriods,
  findEarlyAnnualRows,
  findEarlyMonthlyRows,
  findPodDuplicateAnomalies,
  sumRowsForStato,
  type PodDuplicateFinding,
  type TotalsConsistencyResult,
} from "@/lib/provvigioni-integrity";
import {
  buildProvvigioniListWhere,
  recurringAnnualWhereOr,
  recurringMonthlyWhereOr,
} from "@/lib/provvigioni-filters";
import {
  buildStornoMaps,
  expandContractsToProvvigioneRows,
  getRecurringExpandMode,
  sumExpandedAmountForStato,
  type ContractForProvvigioneRow,
} from "@/lib/provvigioni-rows";

/** Contratti esaminati per ogni giro di anteprima (limite durata su Vercel). */
export const INTEGRITY_SCAN_BATCH = 150;
/** Contratti "replica" esaminati in un solo giro (tabella più piccola). */
export const INTEGRITY_POD_SCAN_LIMIT = 12000;

const INTEGRITY_CONTRACT_SELECT = {
  id: true,
  contractNumber: true,
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
    select: { type: true, companyName: true, firstName: true, lastName: true },
  },
  statusHistory: {
    where: { toStatus: "CHIUSO" as const },
    select: { changedAt: true },
    orderBy: { changedAt: "desc" as const },
    take: 1,
  },
  recurringMonths: {
    select: {
      id: true,
      period: true,
      status: true,
      note: true,
      amount: true,
      paidAt: true,
      settledPeriod: true,
    },
    orderBy: { period: "asc" as const },
  },
} as const;

type IntegrityContract = {
  id: string;
  contractNumber: string;
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

function contractLabel(contract: IntegrityContract): string {
  const client = contract.client;
  const name =
    client?.type === "AZIENDA"
      ? client.companyName ?? "—"
      : [client?.firstName, client?.lastName].filter(Boolean).join(" ") || "—";
  const pod = contract.podPdr || contract.pod || contract.pdr || "—";
  return `${name} · ${contract.supplier?.name ?? "—"} · POD/PDR ${pod} · #${contract.contractNumber}`;
}

export type IntegrityRowFinding = {
  contractId: string;
  contractNumber: string;
  label: string;
  collaboratorName: string;
  supplierName: string;
  category:
    | "missing_monthly"
    | "missing_annual"
    | "early_monthly"
    | "early_annual"
    | "out_of_window_removable"
    | "out_of_window_manual"
    | "duplicate_period";
  /**
   * Periodi coinvolti (YYYY-MM). `monthId` presente solo se la riga esiste
   * già a database (early / out_of_window / duplicate): serve ai pulsanti
   * "Applica" per bonificarla senza dover ripetere la ricerca lato server.
   * Assente per le righe mancanti (missing_*): lì non c'è ancora nulla da
   * identificare, si passa il solo `contractId`.
   */
  periods: Array<{ period: string; label: string; monthId?: string }>;
  detail?: string;
};

export type RecurringAnomalyScan = {
  findings: IntegrityRowFinding[];
  scannedContracts: number;
  countsByCategory: Record<IntegrityRowFinding["category"], number>;
  rowsByCategory: Record<IntegrityRowFinding["category"], number>;
  nextCursor: string | null;
};

function emptyCounts(): Record<IntegrityRowFinding["category"], number> {
  return {
    missing_monthly: 0,
    missing_annual: 0,
    early_monthly: 0,
    early_annual: 0,
    out_of_window_removable: 0,
    out_of_window_manual: 0,
    duplicate_period: 0,
  };
}

/**
 * Anteprima a lotti dei contratti ricorrenti (M/R) attivi: righe mancanti,
 * righe in anticipo, righe extra fuori intervallo, duplicati difensivi.
 * Richiamare finché `nextCursor` non è null.
 */
export async function scanRecurringAnomalies(opts?: {
  cursor?: string | null;
  batchSize?: number;
}): Promise<RecurringAnomalyScan> {
  const batchSize = opts?.batchSize ?? INTEGRITY_SCAN_BATCH;
  const cursor = opts?.cursor ?? null;

  const contracts = (await prisma.contract.findMany({
    where: {
      deletedAt: null,
      isHistorical: false,
      OR: [...recurringMonthlyWhereOr, ...recurringAnnualWhereOr],
    },
    select: INTEGRITY_CONTRACT_SELECT,
    orderBy: { id: "asc" },
    take: batchSize,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })) as IntegrityContract[];

  const now = new Date();
  const findings: IntegrityRowFinding[] = [];
  const countsByCategory = emptyCounts();
  const rowsByCategory = emptyCounts();

  function push(
    contract: IntegrityContract,
    category: IntegrityRowFinding["category"],
    periods: Array<{ period: string; monthId?: string }>,
    detail?: string,
  ) {
    if (periods.length === 0) return;
    findings.push({
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      label: contractLabel(contract),
      collaboratorName: contract.collaborator?.name ?? "—",
      supplierName: contract.supplier?.name ?? "—",
      category,
      periods: periods.map((p) => ({
        period: p.period,
        label: periodLabel(p.period),
        monthId: p.monthId,
      })),
      detail,
    });
    countsByCategory[category] += 1;
    rowsByCategory[category] += periods.length;
  }

  for (const contract of contracts) {
    const missing = findMissing(contract, now);
    if (missing) {
      push(
        contract,
        missing.recurrenceKind === "R" ? "missing_annual" : "missing_monthly",
        missing.missingPeriods.map((period) => ({ period })),
      );
    }

    push(
      contract,
      "early_monthly",
      findEarlyMonthlyRows(contract, now).map((r) => ({ period: r.period, monthId: r.id })),
    );
    push(
      contract,
      "early_annual",
      findEarlyAnnualRows(contract, now).map((r) => ({ period: r.period, monthId: r.id })),
    );

    const outOfWindow = findOutOfWindowMonths(contract, now);
    if (outOfWindow) {
      push(
        contract,
        "out_of_window_removable",
        outOfWindow.removable.map((r) => ({ period: r.period, monthId: r.id })),
        outOfWindow.removable[0]?.reason,
      );
      push(
        contract,
        "out_of_window_manual",
        outOfWindow.manual.map((r) => ({ period: r.period, monthId: r.id })),
        outOfWindow.manual[0]?.reason,
      );
    }

    const duplicates = findDuplicateRecurringPeriods(contract.recurringMonths);
    if (duplicates.length > 0) {
      push(
        contract,
        "duplicate_period",
        duplicates.map((d) => ({ period: d.period, monthId: d.ids.join(",") })),
        `${duplicates.length} periodo/i con più righe`,
      );
    }
  }

  return {
    findings,
    scannedContracts: contracts.length,
    countsByCategory,
    rowsByCategory,
    nextCursor:
      contracts.length === batchSize ? contracts.at(-1)?.id ?? null : null,
  };
}

const POD_DUPLICATE_SELECT = {
  id: true,
  contractNumber: true,
  clientId: true,
  supplierId: true,
  podPdr: true,
  pod: true,
  pdr: true,
  supplyStartDate: true,
  insertionDate: true,
  createdAt: true,
  operationType: true,
  recurrence: true,
  status: true,
  isHistorical: true,
  deletedAt: true,
  archiveLabel: true,
  stornoEndDate: true,
  supplier: { select: { stornoMonths: true } },
  collaborator: { select: { name: true } },
  client: {
    select: { type: true, companyName: true, firstName: true, lastName: true },
  },
} as const;

/**
 * Repliche sullo stesso POD/PDR non gestite correttamente (né in storno, né
 * archiviate, né mensile in attesa del nuovo ingresso). Un solo giro su
 * tutti i contratti (attivi + storici, serve vedere entrambi per sapere se
 * il "vecchio" è stato davvero archiviato) — stesso limite di
 * `archiveSupersededPodContracts`.
 */
export async function scanPodDuplicateAnomalies(): Promise<{
  findings: PodDuplicateFinding[];
  scannedContracts: number;
  truncated: boolean;
}> {
  const contracts = (await prisma.contract.findMany({
    where: {
      deletedAt: null,
      OR: [{ podPdr: { not: null } }, { pod: { not: null } }, { pdr: { not: null } }],
    },
    select: POD_DUPLICATE_SELECT,
    take: INTEGRITY_POD_SCAN_LIMIT,
  })) as Parameters<typeof findPodDuplicateAnomalies>[0];

  const findings = findPodDuplicateAnomalies(contracts, new Date());
  return {
    findings,
    scannedContracts: contracts.length,
    truncated: contracts.length === INTEGRITY_POD_SCAN_LIMIT,
  };
}

/**
 * Bonifica "rate in anticipo" (mensili oltre l'ultimo mese generabile,
 * annuali prima del 13° mese): ri-verifica ogni id sul contratto appena
 * ricaricato prima di eliminarlo. Mai una rata con incasso/rendiconto —
 * quelle non sono mai in questo elenco (le funzioni `findEarly*` le escludono).
 */
export async function applyEarlyRecurringCleanup(
  monthIds: string[],
): Promise<{ deleted: number; rejected: number }> {
  const ids = [...new Set(monthIds.filter(Boolean))];
  if (ids.length === 0) return { deleted: 0, rejected: 0 };

  const rows = await prisma.recurringMonth.findMany({
    where: { id: { in: ids } },
    select: { id: true, contractId: true },
  });
  const contractIds = [...new Set(rows.map((r) => r.contractId))];
  const contracts = (
    contractIds.length > 0
      ? await prisma.contract.findMany({
          where: { id: { in: contractIds } },
          select: INTEGRITY_CONTRACT_SELECT,
        })
      : []
  ) as IntegrityContract[];

  const now = new Date();
  const removable = new Set<string>();
  for (const contract of contracts) {
    for (const row of findEarlyMonthlyRows(contract, now)) removable.add(row.id);
    for (const row of findEarlyAnnualRows(contract, now)) removable.add(row.id);
  }

  let deleted = 0;
  let rejected = 0;
  for (const row of rows) {
    if (!removable.has(row.id)) {
      rejected += 1;
      continue;
    }
    try {
      await prisma.recurringMonth.delete({ where: { id: row.id } });
      deleted += 1;
    } catch {
      rejected += 1;
    }
  }
  return { deleted, rejected };
}

/**
 * Bonifica "repliche POD non gestite": delega a `archiveSupersededPodContracts`
 * (già corretta e usata alla creazione contratto) per ogni POD selezionato.
 * Mai una scrittura diretta qui: solo la funzione che decide storno / mensile
 * in attesa / archiviazione secondo la regola.
 */
export async function applyPodDuplicateArchive(
  podKeys: string[],
): Promise<{ archived: number; keptMonthly: number; keptForStorno: number }> {
  const { archiveSupersededPodContracts } = await import(
    "@/lib/contract-pod-archive"
  );
  let archived = 0;
  let keptMonthly = 0;
  let keptForStorno = 0;
  for (const key of [...new Set(podKeys.filter(Boolean))]) {
    const res = await archiveSupersededPodContracts({ onlyPodKey: key });
    archived += res.archived;
    keptMonthly += res.keptMonthly;
    keptForStorno += res.keptForStorno;
  }
  return { archived, keptMonthly, keptForStorno };
}

const TOTALS_CHECK_SELECT = {
  id: true,
  clientId: true,
  supplierId: true,
  status: true,
  paymentStatus: true,
  recurrence: true,
  podPdr: true,
  pod: true,
  pdr: true,
  collectionDate: true,
  commissionConfirmed: true,
  supplyStartDate: true,
  insertionDate: true,
  createdAt: true,
  expiryDate: true,
  durationMonths: true,
  stornoEndDate: true,
  operationType: true,
  collaboratorId: true,
  notes: true,
  agency: true,
  client: {
    select: { type: true, companyName: true, firstName: true, lastName: true },
  },
  collaborator: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true, stornoMonths: true } },
  commission: {
    select: {
      id: true,
      expected: true,
      received: true,
      paid: true,
      stornoDate: true,
      stornoAmount: true,
    },
  },
  recurringMonths: {
    select: { period: true, status: true, amount: true, settledPeriod: true, note: true },
    orderBy: { period: "asc" as const },
  },
} as const;

/** Limite di sicurezza: oltre questo numero il confronto è parziale (segnalato). */
export const TOTALS_CHECK_CONTRACT_LIMIT = 4000;

/**
 * Confronta, per Incassato / Da incassare / Pagato, il totale "dichiarato"
 * (stessa funzione della card Dashboard/Provvigioni) con la somma
 * indipendente delle righe visibili (stessa espansione della tabella
 * Provvigioni). Devono coincidere sempre — con qualsiasi filtro
 * collaboratore/fornitore. Se non coincidono è un bug di codice, non un
 * dato da correggere: qui non si scrive nulla.
 */
export async function checkProvvigioniTotals(opts: {
  sessionUserId: string;
  collaboratorId?: string | null;
  supplierName?: string | null;
}): Promise<{
  results: TotalsConsistencyResult[];
  scannedContracts: number;
  truncated: boolean;
}> {
  const stati = ["Incassato", "Da incassare", "Pagato"] as const;
  const results: TotalsConsistencyResult[] = [];
  let scannedContracts = 0;
  let truncated = false;

  for (const stato of stati) {
    const where = buildProvvigioniListWhere({
      filters: {
        canViewAll: true,
        sessionUserId: opts.sessionUserId,
        collab: opts.collaboratorId ?? undefined,
        supplier: opts.supplierName ?? undefined,
        recurrenceMode: "all",
        stato,
      },
      applyCompetenceToList: false,
    });
    const expandMode = getRecurringExpandMode(stato, true, undefined);

    const declaredAmount = await sumExpandedAmountForStato(
      where,
      expandMode,
      null,
      stato,
    );

    const contracts = (await prisma.contract.findMany({
      where,
      select: TOTALS_CHECK_SELECT,
      take: TOTALS_CHECK_CONTRACT_LIMIT,
    })) as ContractForProvvigioneRow[];
    scannedContracts = Math.max(scannedContracts, contracts.length);
    if (contracts.length === TOTALS_CHECK_CONTRACT_LIMIT) truncated = true;

    const { latestMap, earlyMap } = buildStornoMaps(contracts);
    const rows = expandContractsToProvvigioneRows(contracts, {
      expandMode,
      statoFilter: stato,
      latestMap,
      earlyMap,
    });
    const rowsAmount = sumRowsForStato(rows, stato);

    results.push(compareTotals(stato, declaredAmount, rowsAmount));
  }

  return { results, scannedContracts, truncated };
}
