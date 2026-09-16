import "server-only";

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { clientDisplayName } from "@/lib/utils";
import { decimalToNumber } from "@/lib/commission";
import {
  firstBillablePeriodForHeliosContract,
  heliosContractCoversPeriod,
  lastBillablePeriodForHeliosContract,
  normalizePersonKey,
  type HeliosContractPeriodMatch,
} from "@/lib/helios-provvigioni-shared";
import {
  isRecurringAnnual,
  isRecurringMonthly,
  monthsBetween,
  toPeriod,
} from "@/lib/recurring";
import { computeSupplyStartDate } from "@/lib/supply-dates";
import type { PayoutMarkMode } from "@/lib/payout/apply";

export type BulkHistoricalExclusionMode = "TOTAL" | "ACTIVE_ONLY";

import { BULK_HISTORICAL_PERIOD_LIMIT } from "@/lib/payout/view-types";

export { BULK_HISTORICAL_PERIOD_LIMIT };
export const BULK_HISTORICAL_SUPPLIER = "Helios";
export const BULK_HISTORICAL_EXCLUDED_NAMES = ["moschetta", "lobefaro"];

export type BulkHistoricalSkipReason =
  | "already_in_target_state"
  | "collaborator_excluded"
  | "storno_applied"
  | "terminal_status"
  | "before_supply_start"
  | "no_amount"
  | "outside_supply_window";

export const BULK_SKIP_REASON_LABEL: Record<BulkHistoricalSkipReason, string> = {
  already_in_target_state: "Già nello stato di destinazione",
  collaborator_excluded: "Collaboratore escluso (Moschetta/Lobefaro)",
  storno_applied: "Storno applicato",
  terminal_status: "Pratica KO o annullata",
  before_supply_start: "Mese precedente all'ingresso in fornitura",
  no_amount: "Importo non determinabile",
  outside_supply_window: "Rata fuori finestra di fornitura del contratto",
};

export type BulkHistoricalCandidate = {
  contractId: string;
  contractNumber: string;
  clientName: string;
  collaboratorId: string;
  collaboratorName: string;
  period: string;
  amount: number | null;
  recurringMonthId: string | null;
  /** true se la rata cade fuori dalla finestra Helios (bonifica consigliata prima) */
  outsideSupplyWindow: boolean;
};

export type BulkHistoricalSkipped = {
  contractId: string;
  contractNumber: string;
  collaboratorName: string;
  period: string;
  reason: BulkHistoricalSkipReason;
  detail?: string;
};

export type BulkHistoricalPlan = {
  supplierName: string;
  periodLimit: string;
  markMode: PayoutMarkMode;
  exclusionMode: BulkHistoricalExclusionMode;
  excludedCollaboratorPatterns: string[];
  signature: string;
  runLabel: string;
  toApply: BulkHistoricalCandidate[];
  skipped: BulkHistoricalSkipped[];
  summary: {
    contractCount: number;
    rateCount: number;
    totalAmount: number;
    outsideWindowCount: number;
    skippedCount: number;
  };
  byCollaborator: Array<{
    collaboratorName: string;
    contractCount: number;
    rateCount: number;
    total: number;
  }>;
  byMonth: Array<{
    period: string;
    rateCount: number;
    total: number;
  }>;
  skippedByReason: Array<{
    reason: BulkHistoricalSkipReason;
    count: number;
  }>;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function matchesExcludedCollaborator(
  collaboratorName: string,
  patterns: string[] = BULK_HISTORICAL_EXCLUDED_NAMES,
): boolean {
  const key = normalizePersonKey(collaboratorName);
  return patterns.some((p) => key.includes(normalizePersonKey(p)));
}

export function bulkHistoricalSignature(params: {
  periodLimit: string;
  markMode: PayoutMarkMode;
  exclusionMode: BulkHistoricalExclusionMode;
  excludedCollaboratorPatterns: string[];
}): string {
  const payload = JSON.stringify({
    kind: "bulk-historical-helios",
    periodLimit: params.periodLimit,
    markMode: params.markMode,
    exclusionMode: params.exclusionMode,
    excluded: [...params.excludedCollaboratorPatterns].sort(),
  });
  return createHash("sha256").update(payload).digest("hex");
}

function targetRecurringStatus(markMode: PayoutMarkMode): "PAID" | "LIQUIDATED" {
  return markMode === "LIQUIDATO" ? "LIQUIDATED" : "PAID";
}

function isAlreadyInTargetState(params: {
  markMode: PayoutMarkMode;
  recurring: boolean;
  contractStatus: string;
  paymentStatus: string | null;
  monthStatus: string | null;
}): boolean {
  if (params.recurring) {
    const target = targetRecurringStatus(params.markMode);
    return params.monthStatus === target;
  }
  if (params.markMode === "LIQUIDATO") {
    return params.contractStatus === "PROVVIGIONE_LIQUIDATA";
  }
  return (
    params.paymentStatus === "Incassato" &&
    (params.contractStatus === "PAGATO_DAL_FORNITORE" ||
      params.contractStatus === "PROVVIGIONE_LIQUIDATA")
  );
}

function toHeliosPeriodMatch(c: {
  supplyStartDate: Date | null;
  insertionDate: Date;
  operationType: string | null;
  expiryDate: Date | null;
}): HeliosContractPeriodMatch {
  return {
    id: "",
    supplyStartDate: c.supplyStartDate,
    insertionDate: c.insertionDate,
    operationType: c.operationType,
    expiryDate: c.expiryDate,
  };
}

function contractPeriodWindow(c: {
  supplyStartDate: Date | null;
  insertionDate: Date;
  operationType: string | null;
  expiryDate: Date | null;
}): { start: string; end: string | null } {
  const match = toHeliosPeriodMatch(c);
  const start = firstBillablePeriodForHeliosContract(match);
  const end = lastBillablePeriodForHeliosContract(match);
  return { start, end };
}

function periodsForContract(
  c: {
    supplyStartDate: Date | null;
    insertionDate: Date;
    operationType: string | null;
    expiryDate: Date | null;
    recurrence: string | null;
  },
  periodLimit: string,
): string[] {
  const { start, end } = contractPeriodWindow(c);
  const last = end && end < periodLimit ? end : periodLimit;
  if (start > last) return [];

  if (isRecurringAnnual(c.recurrence)) {
    const out: string[] = [];
    let cur = start;
    for (let i = 0; i < 30; i++) {
      if (cur > last) break;
      out.push(cur);
      const [y, m] = cur.split("-").map(Number);
      const d = new Date(y, (m ?? 1) - 1, 1);
      d.setFullYear(d.getFullYear() + 1);
      cur = toPeriod(d);
    }
    return out;
  }

  return monthsBetween(start, last);
}

export async function buildBulkHistoricalPlan(params: {
  periodLimit: string;
  markMode: PayoutMarkMode;
  exclusionMode: BulkHistoricalExclusionMode;
  excludedCollaboratorPatterns?: string[];
}): Promise<
  | { ok: true; plan: BulkHistoricalPlan }
  | { ok: false; error: string }
> {
  const excluded =
    params.excludedCollaboratorPatterns ?? BULK_HISTORICAL_EXCLUDED_NAMES;

  const supplier = await prisma.supplier.findFirst({
    where: { name: { equals: BULK_HISTORICAL_SUPPLIER, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!supplier) {
    return { ok: false, error: `Fornitore ${BULK_HISTORICAL_SUPPLIER} non trovato` };
  }

  const contracts = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      supplierId: supplier.id,
      status: { notIn: ["KO", "ANNULLATO"] },
    },
    select: {
      id: true,
      contractNumber: true,
      status: true,
      paymentStatus: true,
      recurrence: true,
      supplyStartDate: true,
      insertionDate: true,
      operationType: true,
      expiryDate: true,
      collaborator: { select: { id: true, name: true } },
      client: {
        select: {
          type: true,
          firstName: true,
          lastName: true,
          companyName: true,
        },
      },
      commission: { select: { expected: true } },
      recurringMonths: {
        where: { period: { lte: params.periodLimit } },
        select: { id: true, period: true, status: true, amount: true },
      },
    },
  });

  const toApply: BulkHistoricalCandidate[] = [];
  const skipped: BulkHistoricalSkipped[] = [];
  const contractIdsApplied = new Set<string>();

  for (const contract of contracts) {
    const collaboratorName = contract.collaborator.name;
    const excludedMatch = matchesExcludedCollaborator(collaboratorName, excluded);

    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const isActive =
      !["KO", "ANNULLATO", "CHIUSO"].includes(contract.status) &&
      contract.supplyStartDate != null &&
      contract.supplyStartDate <= today &&
      (contract.expiryDate == null || contract.expiryDate >= today);

    if (excludedMatch) {
      if (
        params.exclusionMode === "TOTAL" ||
        (params.exclusionMode === "ACTIVE_ONLY" && isActive)
      ) {
        const periods = periodsForContract(contract, params.periodLimit);
        for (const period of periods.length > 0 ? periods : ["—"]) {
          skipped.push({
            contractId: contract.id,
            contractNumber: contract.contractNumber,
            collaboratorName,
            period,
            reason: "collaborator_excluded",
            detail:
              params.exclusionMode === "ACTIVE_ONLY" && !isActive
                ? undefined
                : params.exclusionMode === "ACTIVE_ONLY"
                  ? "Contratto attivo"
                  : "Esclusione totale",
          });
        }
        if (periods.length === 0 && !isRecurringMonthly(contract.recurrence) && !isRecurringAnnual(contract.recurrence)) {
          skipped.push({
            contractId: contract.id,
            contractNumber: contract.contractNumber,
            collaboratorName,
            period: "—",
            reason: "collaborator_excluded",
          });
        }
        continue;
      }
    }

    if (contract.status === "STORNATO") {
      skipped.push({
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        collaboratorName,
        period: "—",
        reason: "storno_applied",
      });
      continue;
    }

    const recurring =
      isRecurringMonthly(contract.recurrence) ||
      isRecurringAnnual(contract.recurrence);
    const monthByPeriod = new Map(
      contract.recurringMonths.map((m) => [m.period, m]),
    );
    const defaultAmount =
      contract.commission?.expected == null
        ? null
        : decimalToNumber(contract.commission.expected);

    const periodMatch = toHeliosPeriodMatch(contract);

    if (recurring) {
      const periods = periodsForContract(contract, params.periodLimit);
      for (const period of periods) {
        const existing = monthByPeriod.get(period);
        const monthStatus = existing?.status ?? null;

        if (
          isAlreadyInTargetState({
            markMode: params.markMode,
            recurring: true,
            contractStatus: contract.status,
            paymentStatus: contract.paymentStatus,
            monthStatus,
          })
        ) {
          skipped.push({
            contractId: contract.id,
            contractNumber: contract.contractNumber,
            collaboratorName,
            period,
            reason: "already_in_target_state",
          });
          continue;
        }

        const supplyStart =
          contract.supplyStartDate ??
          computeSupplyStartDate(contract.insertionDate, contract.operationType);
        const supplyPeriod = toPeriod(supplyStart);
        if (period < supplyPeriod) {
          skipped.push({
            contractId: contract.id,
            contractNumber: contract.contractNumber,
            collaboratorName,
            period,
            reason: "before_supply_start",
          });
          continue;
        }

        const amount =
          existing?.amount == null
            ? defaultAmount
            : decimalToNumber(existing.amount);
        if (amount == null || amount === 0) {
          skipped.push({
            contractId: contract.id,
            contractNumber: contract.contractNumber,
            collaboratorName,
            period,
            reason: "no_amount",
          });
          continue;
        }

        const outsideSupplyWindow = !heliosContractCoversPeriod(
          periodMatch,
          period,
        );

        toApply.push({
          contractId: contract.id,
          contractNumber: contract.contractNumber,
          clientName: clientDisplayName(contract.client),
          collaboratorId: contract.collaborator.id,
          collaboratorName,
          period,
          amount,
          recurringMonthId: existing?.id ?? null,
          outsideSupplyWindow,
        });
        contractIdsApplied.add(contract.id);
      }
      continue;
    }

    // Gettone una tantum
    const firstPeriod = contractPeriodWindow(contract).start;
    if (firstPeriod > params.periodLimit) continue;

    if (
      isAlreadyInTargetState({
        markMode: params.markMode,
        recurring: false,
        contractStatus: contract.status,
        paymentStatus: contract.paymentStatus,
        monthStatus: null,
      })
    ) {
      skipped.push({
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        collaboratorName,
        period: firstPeriod,
        reason: "already_in_target_state",
      });
      continue;
    }

    const amount = defaultAmount;
    if (amount == null || amount === 0) {
      skipped.push({
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        collaboratorName,
        period: firstPeriod,
        reason: "no_amount",
      });
      continue;
    }

    toApply.push({
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      clientName: clientDisplayName(contract.client),
      collaboratorId: contract.collaborator.id,
      collaboratorName,
      period: firstPeriod,
      amount,
      recurringMonthId: null,
      outsideSupplyWindow: false,
    });
    contractIdsApplied.add(contract.id);
  }

  const byCollaboratorMap = new Map<
    string,
    { contractIds: Set<string>; rateCount: number; total: number }
  >();
  const byMonthMap = new Map<string, { rateCount: number; total: number }>();
  let totalAmount = 0;
  let outsideWindowCount = 0;

  for (const row of toApply) {
    totalAmount += row.amount ?? 0;
    if (row.outsideSupplyWindow) outsideWindowCount++;

    const collab = byCollaboratorMap.get(row.collaboratorName) ?? {
      contractIds: new Set<string>(),
      rateCount: 0,
      total: 0,
    };
    collab.contractIds.add(row.contractId);
    collab.rateCount++;
    collab.total += row.amount ?? 0;
    byCollaboratorMap.set(row.collaboratorName, collab);

    const month = byMonthMap.get(row.period) ?? { rateCount: 0, total: 0 };
    month.rateCount++;
    month.total += row.amount ?? 0;
    byMonthMap.set(row.period, month);
  }

  const skippedByReasonMap = new Map<BulkHistoricalSkipReason, number>();
  for (const s of skipped) {
    skippedByReasonMap.set(
      s.reason,
      (skippedByReasonMap.get(s.reason) ?? 0) + 1,
    );
  }

  const signature = bulkHistoricalSignature({
    periodLimit: params.periodLimit,
    markMode: params.markMode,
    exclusionMode: params.exclusionMode,
    excludedCollaboratorPatterns: excluded,
  });

  const runLabel = `Marcatura massiva ${supplier.name} fino a ${params.periodLimit}`;

  return {
    ok: true,
    plan: {
      supplierName: supplier.name,
      periodLimit: params.periodLimit,
      markMode: params.markMode,
      exclusionMode: params.exclusionMode,
      excludedCollaboratorPatterns: excluded,
      signature,
      runLabel,
      toApply,
      skipped,
      summary: {
        contractCount: contractIdsApplied.size,
        rateCount: toApply.length,
        totalAmount: round2(totalAmount),
        outsideWindowCount,
        skippedCount: skipped.length,
      },
      byCollaborator: [...byCollaboratorMap.entries()]
        .map(([collaboratorName, v]) => ({
          collaboratorName,
          contractCount: v.contractIds.size,
          rateCount: v.rateCount,
          total: round2(v.total),
        }))
        .sort((a, b) => a.collaboratorName.localeCompare(b.collaboratorName)),
      byMonth: [...byMonthMap.entries()]
        .map(([period, v]) => ({
          period,
          rateCount: v.rateCount,
          total: round2(v.total),
        }))
        .sort((a, b) => a.period.localeCompare(b.period)),
      skippedByReason: [...skippedByReasonMap.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
    },
  };
}
