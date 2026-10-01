/**
 * Bonifica rate Helios con competenza oltre lastPayable (lag M+2).
 *
 * A settembre 2026 lastPayable = luglio: agosto/settembre non devono esistere
 * (né PENDING né PAID/LIQUIDATED). Percorso automatico (sync/cron) + apply
 * manuale a lotti. Neon HTTP: niente transazioni.
 */
import "server-only";

import { prisma } from "@/lib/prisma";
import {
  heliosLastPayableCompetence,
  isHeliosCompetenceNotYetPayable,
  isHeliosFirstCompetenceLagException,
  isHeliosSupplier,
} from "@/lib/helios-contract-rules";
import { periodLabel } from "@/lib/recurring";
import { clientDisplayName } from "@/lib/utils";
import {
  RECURRING_AUTO_CLOSED_NOTE,
  recurringWindow,
} from "@/lib/recurring-window";
import {
  HELIOS_ANTICIPATORY_APPLY_BATCH,
  HELIOS_ANTICIPATORY_AUTO_MAX_BATCHES,
  HELIOS_ANTICIPATORY_SCAN_BATCH,
  type HeliosAnticipatoryAction,
  type HeliosAnticipatoryRow,
} from "@/lib/helios-anticipatory-shared";

export {
  HELIOS_ANTICIPATORY_APPLY_BATCH,
  HELIOS_ANTICIPATORY_AUTO_MAX_BATCHES,
  HELIOS_ANTICIPATORY_SCAN_BATCH,
  type HeliosAnticipatoryAction,
  type HeliosAnticipatoryRow,
};

const CLOSE_NOTE = RECURRING_AUTO_CLOSED_NOTE.heliosLag;

export type HeliosAnticipatoryScan = {
  rows: HeliosAnticipatoryRow[];
  lastPayableCompetence: string;
  scannedMonths: number;
  nextCursor: string | null;
};

function suggestedAction(row: {
  status: string;
  paidAt: Date | null;
  settledPeriod: string | null;
}): HeliosAnticipatoryAction {
  if (row.paidAt != null || row.settledPeriod != null) return "close";
  if (row.status === "PAID" || row.status === "LIQUIDATED" || row.status === "ERROR_UNPAID") {
    return "close";
  }
  return "delete";
}

/**
 * Anteprima: rate Helios con `period` > lastPayableCompetence.
 * Paginazione per id (cursor). Non scrive nulla.
 */
export async function scanHeliosAnticipatoryRates(opts?: {
  cursor?: string | null;
  batchSize?: number;
  now?: Date;
}): Promise<HeliosAnticipatoryScan> {
  const now = opts?.now ?? new Date();
  const lastPayable = heliosLastPayableCompetence(now);
  const batchSize = Math.min(
    Math.max(Number(opts?.batchSize) || HELIOS_ANTICIPATORY_SCAN_BATCH, 10),
    HELIOS_ANTICIPATORY_SCAN_BATCH,
  );
  const cursor = opts?.cursor?.trim() || null;

  const months = await prisma.recurringMonth.findMany({
    where: {
      period: { gt: lastPayable },
      ...(cursor ? { id: { gt: cursor } } : {}),
      contract: {
        deletedAt: null,
        isHistorical: false,
        supplier: { name: { contains: "helios", mode: "insensitive" } },
      },
    },
    select: {
      id: true,
      period: true,
      status: true,
      amount: true,
      paidAt: true,
      settledPeriod: true,
      note: true,
      contract: {
        select: {
          id: true,
          podPdr: true,
          operationType: true,
          insertionDate: true,
          supplyStartDate: true,
          status: true,
          expiryDate: true,
          statusHistory: {
            where: { toStatus: "CHIUSO" as const },
            select: { changedAt: true },
            orderBy: { changedAt: "desc" as const },
            take: 1,
          },
          collaborator: { select: { name: true } },
          client: {
            select: {
              type: true,
              companyName: true,
              firstName: true,
              lastName: true,
            },
          },
          supplier: { select: { name: true } },
        },
      },
    },
    orderBy: { id: "asc" },
    take: batchSize + 1,
  });

  const page = months.slice(0, batchSize);
  const nextCursor =
    months.length > batchSize ? (page[page.length - 1]?.id ?? null) : null;

  const rows: HeliosAnticipatoryRow[] = [];
  for (const m of page) {
    if (!isHeliosSupplier(m.contract.supplier.name)) continue;
    if (!isHeliosCompetenceNotYetPayable(m.period, now)) continue;
    const window = recurringWindow(m.contract, now);
    if (
      isHeliosFirstCompetenceLagException({
        operationType: m.contract.operationType,
        competencePeriod: m.period,
        supplyStartPeriod: window.start,
      })
    ) {
      continue;
    }
    // Già chiuse col lag: restano in anteprima solo se Michele vuole eliminarle.
    const clientLabel = clientDisplayName(m.contract.client);
    const pod = m.contract.podPdr?.trim() || "—";
    rows.push({
      id: m.id,
      contractId: m.contract.id,
      contractLabel: `${clientLabel} · ${pod}`,
      collaboratorName: m.contract.collaborator.name,
      period: m.period,
      periodLabel: periodLabel(m.period),
      status: m.status,
      amount: m.amount == null ? null : Number(m.amount),
      settledPeriod: m.settledPeriod,
      suggestedAction: suggestedAction(m),
    });
  }

  return {
    rows,
    lastPayableCompetence: lastPayable,
    scannedMonths: page.length,
    nextCursor,
  };
}

export type HeliosAnticipatoryApplyResult = {
  closed: number;
  deleted: number;
  skipped: number;
  monthIds: string[];
  lastPayableCompetence: string;
};

/**
 * Applica su id selezionati. Rivalida sempre `period > lastPayable` + fornitore Helios.
 * - delete: PENDING/MISSING/CLOSED senza paidAt/settled
 * - close: PAID/LIQUIDATED → CLOSED + nota lag, azzera paidAt/settledPeriod
 * Non tocca competenze ≤ lastPayable (luglio e precedenti).
 */
export async function applyHeliosAnticipatoryCleanup(opts: {
  monthIds: string[];
  now?: Date;
}): Promise<HeliosAnticipatoryApplyResult> {
  const now = opts.now ?? new Date();
  const lastPayable = heliosLastPayableCompetence(now);
  const ids = [...new Set(opts.monthIds ?? [])].filter(Boolean);
  if (ids.length === 0) {
    return {
      closed: 0,
      deleted: 0,
      skipped: 0,
      monthIds: [],
      lastPayableCompetence: lastPayable,
    };
  }
  if (ids.length > HELIOS_ANTICIPATORY_APPLY_BATCH) {
    throw new Error(`Massimo ${HELIOS_ANTICIPATORY_APPLY_BATCH} rate per lotto`);
  }

  const months = await prisma.recurringMonth.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      period: true,
      status: true,
      paidAt: true,
      settledPeriod: true,
      note: true,
      contract: {
        select: {
          operationType: true,
          insertionDate: true,
          supplyStartDate: true,
          status: true,
          expiryDate: true,
          statusHistory: {
            where: { toStatus: "CHIUSO" as const },
            select: { changedAt: true },
            orderBy: { changedAt: "desc" as const },
            take: 1,
          },
          supplier: { select: { name: true } },
        },
      },
    },
  });

  let closed = 0;
  let deleted = 0;
  let skipped = 0;
  const done: string[] = [];

  for (const m of months) {
    if (!isHeliosSupplier(m.contract.supplier.name)) {
      skipped += 1;
      continue;
    }
    if (!isHeliosCompetenceNotYetPayable(m.period, now) || m.period <= lastPayable) {
      skipped += 1;
      continue;
    }
    const window = recurringWindow(m.contract, now);
    if (
      isHeliosFirstCompetenceLagException({
        operationType: m.contract.operationType,
        competencePeriod: m.period,
        supplyStartPeriod: window.start,
      })
    ) {
      skipped += 1;
      continue;
    }
    // Già bonificata in un passaggio precedente: idempotente.
    if (m.status === "CLOSED" && m.note === CLOSE_NOTE) {
      skipped += 1;
      continue;
    }

    const action = suggestedAction(m);
    if (action === "delete") {
      await prisma.recurringMonth.delete({ where: { id: m.id } });
      deleted += 1;
      done.push(m.id);
      continue;
    }

    await prisma.recurringMonth.update({
      where: { id: m.id },
      data: {
        status: "CLOSED",
        paidAt: null,
        settledPeriod: null,
        note: CLOSE_NOTE,
      },
    });
    closed += 1;
    done.push(m.id);
  }

  // Id richiesti ma non trovati / saltati
  skipped += ids.length - months.length;

  return {
    closed,
    deleted,
    skipped,
    monthIds: done,
    lastPayableCompetence: lastPayable,
  };
}

export type HeliosAnticipatoryAutoResult = HeliosAnticipatoryApplyResult & {
  batches: number;
  done: boolean;
};

/**
 * Pass automatico (sync Provvigioni / cron): bonifica fino a
 * `HELIOS_ANTICIPATORY_AUTO_MAX_BATCHES` lotti. Idempotente; non tocca ≤ lastPayable.
 */
export async function runHeliosAnticipatoryCleanupAuto(opts?: {
  now?: Date;
  maxBatches?: number;
}): Promise<HeliosAnticipatoryAutoResult> {
  const now = opts?.now ?? new Date();
  const lastPayable = heliosLastPayableCompetence(now);
  const maxBatches = Math.min(
    Math.max(Number(opts?.maxBatches) || HELIOS_ANTICIPATORY_AUTO_MAX_BATCHES, 1),
    HELIOS_ANTICIPATORY_AUTO_MAX_BATCHES,
  );

  let closed = 0;
  let deleted = 0;
  let skipped = 0;
  const monthIds: string[] = [];
  let batches = 0;
  let done = true;

  for (let i = 0; i < maxBatches; i++) {
    const pending = await prisma.recurringMonth.findMany({
      where: {
        period: { gt: lastPayable },
        NOT: {
          AND: [{ status: "CLOSED" }, { note: CLOSE_NOTE }],
        },
        contract: {
          deletedAt: null,
          isHistorical: false,
          supplier: { name: { contains: "helios", mode: "insensitive" } },
        },
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: HELIOS_ANTICIPATORY_APPLY_BATCH,
    });

    if (pending.length === 0) {
      done = true;
      break;
    }

    batches += 1;
    const result = await applyHeliosAnticipatoryCleanup({
      monthIds: pending.map((r) => r.id),
      now,
    });
    closed += result.closed;
    deleted += result.deleted;
    skipped += result.skipped;
    monthIds.push(...result.monthIds);

    // Solo eccezioni prima competenza (o già saltate): evita loop infinito.
    if (result.closed + result.deleted === 0) {
      done = true;
      break;
    }

    if (pending.length < HELIOS_ANTICIPATORY_APPLY_BATCH) {
      done = true;
      break;
    }
    done = false;
  }

  if (closed + deleted > 0) {
    console.info("[helios-anticipatory-auto]", {
      closed,
      deleted,
      skipped,
      batches,
      done,
      lastPayable,
    });
  }

  return {
    closed,
    deleted,
    skipped,
    monthIds,
    lastPayableCompetence: lastPayable,
    batches,
    done,
  };
}
