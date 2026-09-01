/**
 * Espansione righe Provvigioni: un clone per ogni mese ricorrente (M)
 * quando si visualizzano tutti i periodi con filtro Incassato/Da incassare/Pagato.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { pageSkip as paginationSkip } from "@/lib/pagination";
import { formatMonthYear } from "@/lib/date-parse";
import { clientDisplayName } from "@/lib/utils";
import {
  effectiveCollectionDate,
  markEarlyReswitchContracts,
  markLatestContractsByPod,
  resolveStornoInfo,
} from "@/lib/storno-status";
import {
  computeSupplyStartDate,
  formatItDate,
  isInFornitura,
} from "@/lib/supply-dates";
import { isRecurringMonthly, periodLabel } from "@/lib/recurring";
import {
  nonRecurringWhere,
  parseStatoFilter,
  recurringMonthlyWhereOr,
} from "@/lib/provvigioni-filters";
import {
  effectiveGettone,
  operationTypeLabel,
  provvigioneAgencyLabel,
  provvigioneDisplayAmount,
  simplifiedProvvigioneStato,
  type ProvvigioneRow,
} from "@/lib/provvigioni-stato";

export type RecurringExpandMode = "incassato" | "da-incassare" | "pagato";

const NON_RECURRING_WHERE: Prisma.ContractWhereInput = nonRecurringWhere;

const MONTHLY_RECURRING_WHERE: Prisma.ContractWhereInput = {
  OR: recurringMonthlyWhereOr,
};

function rateStatusesForMode(mode: RecurringExpandMode): string[] {
  if (mode === "incassato") return ["PAID"];
  if (mode === "da-incassare") return ["MISSING", "PENDING", "ERROR_UNPAID"];
  return ["LIQUIDATED"];
}

function monthNoteForMode(mode: RecurringExpandMode, period: string): string {
  const label = periodLabel(period);
  if (mode === "incassato") return `Competenza ${label} · incassato, da liquidare`;
  if (mode === "da-incassare") return `Competenza ${label} · da incassare`;
  return `Competenza ${label} · pagato al collaboratore`;
}

/** Espandi rate mensili quando tutti i periodi + un solo filtro stato rate-based. */
export function getRecurringExpandMode(
  stato: string | undefined | null,
  viewingAllPeriods: boolean,
  effectiveCompetence: string | undefined,
): RecurringExpandMode | null {
  if (!viewingAllPeriods || effectiveCompetence) return null;
  const parts = parseStatoFilter(stato);
  if (parts.length !== 1) return null;
  const s = parts[0]!;
  if (s === "Incassato") return "incassato";
  if (s === "Da incassare") return "da-incassare";
  if (s === "Pagato") return "pagato";
  return null;
}

export type ContractForProvvigioneRow = {
  id: string;
  clientId: string;
  supplierId: string;
  status: string;
  paymentStatus: string | null;
  recurrence: string | null;
  podPdr: string | null;
  pod: string | null;
  pdr: string | null;
  collectionDate: Date | null;
  commissionConfirmed: boolean;
  supplyStartDate: Date | null;
  insertionDate: Date | null;
  createdAt: Date;
  expiryDate: Date | null;
  durationMonths: number | null;
  stornoEndDate: Date | null;
  operationType: string | null;
  collaboratorId: string;
  notes: string | null;
  client: {
    type: string;
    companyName: string | null;
    firstName: string | null;
    lastName: string | null;
  };
  collaborator: { id: string; name: string };
  supplier: { id: string; name: string; stornoMonths: number | null };
  commission: {
    id: string;
    expected: unknown;
    received: unknown;
    paid: unknown;
    stornoDate: Date | null;
    stornoAmount: unknown;
  } | null;
  recurringMonths: Array<{
    period: string;
    status: string;
    amount: unknown;
  }>;
};

export type BuildProvvigioneRowsOpts = {
  effectiveCompetence?: string;
  expandMode: RecurringExpandMode | null;
  latestMap: Map<string, boolean>;
  earlyMap: Map<string, boolean>;
  now?: Date;
};

function monthAmount(
  month: { amount: unknown },
  contract: ContractForProvvigioneRow,
): number {
  if (month.amount != null) {
    const n = Number(String(month.amount));
    if (n > 0) return n;
  }
  return effectiveGettone({
    expected: Number(contract.commission?.expected ?? 0),
    clientType: contract.client.type,
    supplierName: contract.supplier.name,
  });
}

function buildSingleRow(
  contract: ContractForProvvigioneRow,
  opts: BuildProvvigioneRowsOpts,
  monthOverride?: { period: string; status: string; amount: number },
): ProvvigioneRow {
  const item = contract.commission;
  const now = opts.now ?? new Date();
  const supply =
    contract.supplyStartDate ??
    computeSupplyStartDate(
      contract.insertionDate ?? contract.createdAt,
      contract.operationType,
    );
  const inFornitura = isInFornitura(supply, now);
  const effectiveCollection = effectiveCollectionDate(
    contract.collectionDate,
    supply,
  );

  const competencePeriod = monthOverride?.period ?? opts.effectiveCompetence;
  const expandStato = monthOverride
    ? monthOverride.status === "PAID"
      ? "Incassato"
      : monthOverride.status === "LIQUIDATED"
        ? "Pagato"
        : "Da incassare"
    : null;

  const paidRecurringForCompetence = competencePeriod
    ? (contract.recurringMonths ?? []).some(
        (m) =>
          m.period === competencePeriod &&
          (m.status === "PAID" || m.status === "LIQUIDATED"),
      )
    : (contract.recurringMonths ?? []).some((m) => m.status === "PAID");

  const hasDate =
    expandStato === "Incassato" ||
    expandStato === "Pagato" ||
    Boolean(effectiveCollection) ||
    paidRecurringForCompetence;

  const paidLabel =
    expandStato === "Pagato"
      ? "Pagato"
      : expandStato === "Incassato" || hasDate
        ? "Incassato"
        : "Da incassare";

  const collectionMonth = monthOverride
    ? formatMonthYear(new Date(`${monthOverride.period}-01`))
    : competencePeriod
      ? (() => {
          const m = (contract.recurringMonths ?? []).find(
            (r) =>
              r.period === competencePeriod &&
              (r.status === "PAID" || r.status === "LIQUIDATED"),
          );
          return m
            ? formatMonthYear(new Date(`${m.period}-01`))
            : hasDate
              ? formatMonthYear(effectiveCollection)
              : "";
        })()
      : hasDate
        ? formatMonthYear(effectiveCollection)
        : "";

  const activationNote =
    !inFornitura && supply && !monthOverride
      ? `attiv. ${formatMonthYear(supply)}`
      : undefined;

  const storno = resolveStornoInfo({
    status: contract.status,
    recurrence: contract.recurrence,
    supplyStartDate: supply,
    stornoMonths: contract.supplier.stornoMonths,
    stornoEndDate: contract.stornoEndDate,
    expiryDate: contract.expiryDate,
    durationMonths: contract.durationMonths,
    isLatestForPod: opts.latestMap.get(contract.id) ?? true,
    collectionDate: effectiveCollection,
    isEarlyReswitch: opts.earlyMap.get(contract.id) ?? false,
  });

  const stato =
    expandStato ??
    simplifiedProvvigioneStato(contract.status, hasDate, {
      inFornitura: inFornitura || paidRecurringForCompetence,
      hasStorno: Boolean(item?.stornoDate),
    });

  const amountValue = monthOverride
    ? monthOverride.amount
    : competencePeriod
      ? (() => {
          const row = (contract.recurringMonths ?? []).find(
            (m) => m.period === competencePeriod,
          );
          if (row) return monthAmount(row, contract);
          return effectiveGettone({
            expected: Number(item?.expected ?? 0),
            clientType: contract.client.type,
            supplierName: contract.supplier.name,
          });
        })()
      : effectiveGettone({
          expected: Number(item?.expected ?? 0),
          clientType: contract.client.type,
          supplierName: contract.supplier.name,
        });

  const recurringIncassoNote = monthOverride
    ? monthNoteForMode(
        monthOverride.status === "PAID"
          ? "incassato"
          : monthOverride.status === "LIQUIDATED"
            ? "pagato"
            : "da-incassare",
        monthOverride.period,
      )
    : activationNote;

  const rowKey = monthOverride
    ? `${contract.id}:${monthOverride.period}`
    : contract.id;

  return {
    id: rowKey,
    rowKey,
    contractId: contract.id,
    competencePeriod: monthOverride?.period ?? opts.effectiveCompetence,
    clientId: contract.clientId,
    commissionId: item?.id ?? "",
    clientName: clientDisplayName(contract.client),
    podPdr: contract.podPdr || contract.pod || contract.pdr || "",
    collaboratorName: contract.collaborator?.name ?? "—",
    supplierName: contract.supplier.name,
    agency: provvigioneAgencyLabel(contract.supplier.name),
    clientType: contract.client.type === "AZIENDA" ? "Business" : "Domestico",
    amount: String(amountValue),
    supplyStartDate: supply ? formatItDate(supply) : "",
    operationType: operationTypeLabel(contract.operationType),
    recurrence: contract.recurrence || "Una tantum",
    stato,
    paymentStatus: paidLabel,
    confirmed: contract.commissionConfirmed ? "Confermata" : "Da confermare",
    collectionMonth,
    recurringIncassoNote,
    stornoFlag: item?.stornoDate ? "Sì" : "No",
    stornoMonth: item?.stornoDate ? formatMonthYear(item.stornoDate) : "",
    stornoAmount:
      item?.stornoAmount != null ? String(Number(item.stornoAmount)) : "",
    notes: contract.notes || "",
    stornoLabel:
      stato === "Da controllare"
        ? "Da controllare (non ancora contrattualizzato)"
        : stato === "Stornato"
          ? "Stornato (clawback applicato)"
          : storno.label,
    stornoRowClass:
      stato === "Da controllare"
        ? "bg-fuchsia-100 hover:bg-fuchsia-200/80"
        : stato === "Stornato"
          ? "bg-rose-100 hover:bg-rose-200/80"
          : storno.rowClassName,
    warnOnEdit: storno.warnOnEdit,
    missingSupplyStart: storno.missingSupplyStart === true,
    gettoneBorderClass: contract.commissionConfirmed
      ? "border-l-4 border-l-emerald-600"
      : "border-l-4 border-l-amber-500",
  };
}

/** Una riga per contratto UT; N righe per ogni mese M nel filtro stato. */
export function expandContractsToProvvigioneRows(
  contracts: ContractForProvvigioneRow[],
  opts: BuildProvvigioneRowsOpts,
): ProvvigioneRow[] {
  const mode = opts.expandMode;
  if (!mode) {
    return contracts.map((c) => buildSingleRow(c, opts));
  }

  const statuses = rateStatusesForMode(mode);
  const rows: ProvvigioneRow[] = [];

  for (const contract of contracts) {
    if (!isRecurringMonthly(contract.recurrence)) {
      rows.push(buildSingleRow(contract, opts));
      continue;
    }

    const months = (contract.recurringMonths ?? [])
      .filter((m) => statuses.includes(m.status))
      .sort((a, b) => b.period.localeCompare(a.period));

    for (const month of months) {
      rows.push(
        buildSingleRow(contract, opts, {
          period: month.period,
          status: month.status,
          amount: monthAmount(month, contract),
        }),
      );
    }
  }

  return rows;
}

export function buildStornoMaps(contracts: ContractForProvvigioneRow[]): {
  latestMap: Map<string, boolean>;
  earlyMap: Map<string, boolean>;
} {
  const latestMap = markLatestContractsByPod(
    contracts.map((c) => ({
      id: c.id,
      clientId: c.clientId,
      supplierId: c.supplierId,
      podPdr: c.podPdr || c.pod || c.pdr,
      supplyStartDate: c.supplyStartDate,
      insertionDate: c.insertionDate,
      createdAt: c.createdAt,
    })),
  );
  const earlyMap = markEarlyReswitchContracts(
    contracts.map((c) => ({
      id: c.id,
      clientId: c.clientId,
      supplierId: c.supplierId,
      podPdr: c.podPdr || c.pod || c.pdr,
      supplyStartDate: c.supplyStartDate,
      insertionDate: c.insertionDate,
      createdAt: c.createdAt,
      collectionDate: c.collectionDate,
      stornoMonths: c.supplier.stornoMonths,
      stornoEndDate: c.stornoEndDate,
    })),
  );
  return { latestMap, earlyMap };
}

async function countRecurringRates(
  contractWhere: Prisma.ContractWhereInput,
  mode: RecurringExpandMode,
): Promise<number> {
  return prisma.recurringMonth.count({
    where: {
      status: { in: rateStatusesForMode(mode) },
      contract: {
        AND: [contractWhere, MONTHLY_RECURRING_WHERE],
      },
    },
  });
}

async function countNonRecurringContracts(
  contractWhere: Prisma.ContractWhereInput,
): Promise<number> {
  return prisma.contract.count({
    where: {
      AND: [contractWhere, NON_RECURRING_WHERE],
    },
  });
}

/** Conteggio righe elenco (rate mensili + contratti UT). */
export async function countExpandedListRows(
  contractWhere: Prisma.ContractWhereInput,
  expandMode: RecurringExpandMode | null,
): Promise<number> {
  if (!expandMode) {
    return prisma.contract.count({ where: contractWhere });
  }
  const [rateCount, utCount] = await Promise.all([
    countRecurringRates(contractWhere, expandMode),
    countNonRecurringContracts(contractWhere),
  ]);
  return rateCount + utCount;
}

type RateAmountContract = {
  client: { type: string };
  supplier: { name: string };
  commission: { expected: unknown } | null;
};

function amountFromRate(
  amount: unknown,
  contract: RateAmountContract,
): number {
  if (amount != null) {
    const n = Number(String(amount));
    if (n > 0) return n;
  }
  return effectiveGettone({
    expected: Number(contract.commission?.expected ?? 0),
    clientType: contract.client.type,
    supplierName: contract.supplier.name,
  });
}

/** Somma importi colonna Gettone allineata alle righe espanse. */
export async function sumExpandedAmountForStato(
  contractWhere: Prisma.ContractWhereInput,
  expandMode: RecurringExpandMode | null,
  competencePeriod: string | null,
): Promise<number> {
  if (!expandMode) {
    const contracts = await prisma.contract.findMany({
      where: contractWhere,
      select: {
        client: { select: { type: true } },
        supplier: { select: { name: true } },
        commission: { select: { expected: true } },
        ...(competencePeriod
          ? {
              recurringMonths: {
                where: { period: competencePeriod },
                select: { period: true, amount: true },
              },
            }
          : {}),
      },
    });
    return contracts.reduce(
      (sum, c) =>
        sum +
        provvigioneDisplayAmount({
          commissionExpected: Number(c.commission?.expected ?? 0),
          clientType: c.client.type,
          supplierName: c.supplier.name,
          recurringMonths:
            "recurringMonths" in c
              ? (c.recurringMonths as Array<{
                  period: string;
                  amount: { toString(): string } | null;
                }>)
              : undefined,
          competencePeriod,
        }),
      0,
    );
  }

  const statuses = rateStatusesForMode(expandMode);
  const [rateAgg, fallbackRates, utContracts] = await Promise.all([
    prisma.recurringMonth.aggregate({
      where: {
        status: { in: statuses },
        contract: {
          AND: [contractWhere, MONTHLY_RECURRING_WHERE],
        },
        amount: { gt: 0 },
      },
      _sum: { amount: true },
    }),
    prisma.recurringMonth.findMany({
      where: {
        status: { in: statuses },
        contract: {
          AND: [contractWhere, MONTHLY_RECURRING_WHERE],
        },
        OR: [{ amount: null }, { amount: { lte: 0 } }],
      },
      select: {
        contract: {
          select: {
            client: { select: { type: true } },
            supplier: { select: { name: true } },
            commission: { select: { expected: true } },
          },
        },
      },
      take: 5000,
    }),
    prisma.contract.findMany({
      where: {
        AND: [contractWhere, NON_RECURRING_WHERE],
      },
      select: {
        client: { select: { type: true } },
        supplier: { select: { name: true } },
        commission: { select: { expected: true } },
      },
    }),
  ]);

  const rateSum =
    Number(rateAgg._sum.amount ?? 0) +
    fallbackRates.reduce(
      (sum, r) => sum + amountFromRate(null, r.contract),
      0,
    );
  const utSum = utContracts.reduce(
    (sum, c) =>
      sum +
      effectiveGettone({
        expected: Number(c.commission?.expected ?? 0),
        clientType: c.client.type,
        supplierName: c.supplier.name,
      }),
    0,
  );
  return rateSum + utSum;
}

/** Conteggio card per stato quando si vedono tutti i periodi (rate + UT). */
export async function countExpandedForStatoCard(
  contractWhere: Prisma.ContractWhereInput,
  stato: "Incassato" | "Da incassare" | "Pagato",
  viewingAllPeriods: boolean,
  effectiveCompetence: string | undefined,
): Promise<number> {
  const mode = getRecurringExpandMode(stato, viewingAllPeriods, effectiveCompetence);
  if (!mode) {
    return prisma.contract.count({ where: contractWhere });
  }
  return countExpandedListRows(contractWhere, mode);
}

/** Contratti leggeri per mappe storno (senza caricare tutte le rate). */
export async function loadStornoContractsForMaps(
  contractWhere: Prisma.ContractWhereInput,
): Promise<ContractForProvvigioneRow[]> {
  return prisma.contract.findMany({
    where: contractWhere,
    select: {
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
      client: {
        select: {
          type: true,
          companyName: true,
          firstName: true,
          lastName: true,
        },
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
    },
  }) as Promise<ContractForProvvigioneRow[]>;
}

/** Storno mappe solo per i contratti visibili in pagina (leggero). */
export async function loadStornoContractsForIds(
  contractIds: string[],
): Promise<ContractForProvvigioneRow[]> {
  if (contractIds.length === 0) return [];
  return prisma.contract.findMany({
    where: { id: { in: contractIds } },
    select: {
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
      client: {
        select: {
          type: true,
          companyName: true,
          firstName: true,
          lastName: true,
        },
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
    },
  }) as Promise<ContractForProvvigioneRow[]>;
}

/** Pagina elenco espanso: pagina rate/UT direttamente in DB (no scan completo). */
export async function fetchExpandedProvvigionePage(args: {
  contractWhere: Prisma.ContractWhereInput;
  expandMode: RecurringExpandMode;
  page: number;
  pageSize: number;
  contractSelect: Prisma.ContractSelect;
  buildOpts: BuildProvvigioneRowsOpts;
  orderBy: Prisma.ContractOrderByWithRelationInput[];
}): Promise<{
  rows: ProvvigioneRow[];
  contracts: ContractForProvvigioneRow[];
}> {
  const statuses = rateStatusesForMode(args.expandMode);
  const skip = paginationSkip(args.page, args.pageSize);
  const take = args.pageSize;

  const utWhere: Prisma.ContractWhereInput = {
    AND: [args.contractWhere, NON_RECURRING_WHERE],
  };
  const rateWhere: Prisma.RecurringMonthWhereInput = {
    status: { in: statuses },
    contract: { AND: [args.contractWhere, MONTHLY_RECURRING_WHERE] },
  };

  type PageItem =
    | { kind: "ut"; contract: ContractForProvvigioneRow }
    | {
        kind: "rate";
        contract: ContractForProvvigioneRow;
        rate: { period: string; status: string; amount: unknown };
      };

  const items: PageItem[] = [];
  const utCount = await prisma.contract.count({ where: utWhere });

  if (skip < utCount) {
    const utTake = Math.min(take, utCount - skip);
    const utContracts = await prisma.contract.findMany({
      where: utWhere,
      select: args.contractSelect,
      orderBy: args.orderBy,
      skip,
      take: utTake,
    });
    for (const contract of utContracts) {
      items.push({ kind: "ut", contract: contract as ContractForProvvigioneRow });
    }
    const remaining = take - utTake;
    if (remaining > 0) {
      const rates = await prisma.recurringMonth.findMany({
        where: rateWhere,
        orderBy: [{ period: "desc" }, { contractId: "asc" }],
        take: remaining,
        select: {
          period: true,
          status: true,
          amount: true,
          contract: { select: args.contractSelect },
        },
      });
      for (const rate of rates) {
        items.push({
          kind: "rate",
          contract: rate.contract as ContractForProvvigioneRow,
          rate: {
            period: rate.period,
            status: rate.status,
            amount: rate.amount,
          },
        });
      }
    }
  } else {
    const rateSkip = skip - utCount;
    const rates = await prisma.recurringMonth.findMany({
      where: rateWhere,
      orderBy: [{ period: "desc" }, { contractId: "asc" }],
      skip: rateSkip,
      take,
      select: {
        period: true,
        status: true,
        amount: true,
        contract: { select: args.contractSelect },
      },
    });
    for (const rate of rates) {
      items.push({
        kind: "rate",
        contract: rate.contract as ContractForProvvigioneRow,
        rate: {
          period: rate.period,
          status: rate.status,
          amount: rate.amount,
        },
      });
    }
  }

  const contractIds = [...new Set(items.map((i) => i.contract.id))];
  const stornoMaps = buildStornoMaps(
    await loadStornoContractsForIds(contractIds),
  );
  const buildOpts: BuildProvvigioneRowsOpts = {
    ...args.buildOpts,
    latestMap: stornoMaps.latestMap,
    earlyMap: stornoMaps.earlyMap,
  };

  const rows: ProvvigioneRow[] = items.map((item) =>
    item.kind === "ut"
      ? buildSingleRow(item.contract, buildOpts)
      : buildSingleRow(item.contract, buildOpts, {
          period: item.rate.period,
          status: item.rate.status,
          amount: monthAmount(item.rate, item.contract),
        }),
  );

  const contracts = [
    ...new Map(items.map((i) => [i.contract.id, i.contract])).values(),
  ];
  return { rows, contracts };
}

export { isRecurringMonthly };
