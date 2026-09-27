"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import {
  applyAnnualPastYearsCleanup,
  countAnnualOpenKept,
  runAnnualPastYearsCleanupAuto,
  scanAnnualPastYears,
} from "@/lib/annual-past-years-cleanup";
import {
  ANNUAL_PAST_YEARS_APPLY_BATCH,
  ANNUAL_PAST_YEARS_OPEN_FROM,
  ANNUAL_PAST_YEARS_SCAN_BATCH,
  type AnnualPastYearsRow,
} from "@/lib/annual-past-years-shared";
import { periodLabel } from "@/lib/recurring";

export type AnnualPastYearsScanResult =
  | {
      ok: true;
      rows: AnnualPastYearsRow[];
      openFrom: string;
      openFromLabel: string;
      scanned: number;
      nextCursor: string | null;
      openKept: number;
    }
  | { ok: false; error: string };

export type AnnualPastYearsApplyResult =
  | {
      ok: true;
      monthsLiquidated: number;
      contractsLiquidated: number;
      skipped: number;
      openKept: number;
      openFrom: string;
      done?: boolean;
      batches?: number;
    }
  | { ok: false; error: string };

async function requireAnnualCleanupSession() {
  const session = await requireSession();
  if (session.role !== "ADMIN" && !hasPermission(session.role, "backup.manage")) {
    throw new Error(
      "Permesso negato: bonifica annuali riservata agli amministratori",
    );
  }
  return session;
}

/** Anteprima a lotti: nessuna scrittura. */
export async function scanAnnualPastYearsAction(input?: {
  cursor?: string | null;
  batchSize?: number;
}): Promise<AnnualPastYearsScanResult> {
  try {
    await requireAnnualCleanupSession();
    const batchSize = Math.min(
      Math.max(Number(input?.batchSize) || ANNUAL_PAST_YEARS_SCAN_BATCH, 10),
      ANNUAL_PAST_YEARS_SCAN_BATCH,
    );
    const scan = await scanAnnualPastYears({
      cursor: input?.cursor ?? null,
      batchSize,
    });
    const openKept = await countAnnualOpenKept(scan.openFrom);
    return {
      ok: true,
      rows: scan.rows,
      openFrom: scan.openFrom,
      openFromLabel: periodLabel(scan.openFrom),
      scanned: scan.scanned,
      nextCursor: scan.nextCursor,
      openKept,
    };
  } catch (e) {
    console.error("[scanAnnualPastYearsAction]", e);
    return {
      ok: false,
      error:
        e instanceof Error ? e.message.slice(0, 200) : "Anteprima non riuscita",
    };
  }
}

/** Applica liquidazione sulle righe selezionate (max lotto). */
export async function applyAnnualPastYearsAction(input: {
  targetIds: string[];
}): Promise<AnnualPastYearsApplyResult> {
  try {
    const session = await requireAnnualCleanupSession();
    const ids = [...new Set(input.targetIds ?? [])].filter(Boolean);
    if (ids.length === 0) {
      return { ok: false, error: "Nessuna riga selezionata" };
    }
    if (ids.length > ANNUAL_PAST_YEARS_APPLY_BATCH) {
      return {
        ok: false,
        error: `Massimo ${ANNUAL_PAST_YEARS_APPLY_BATCH} righe per lotto`,
      };
    }

    const result = await applyAnnualPastYearsCleanup({
      targetIds: ids,
      changedById: session.id,
    });

    if (result.monthsLiquidated + result.contractsLiquidated > 0) {
      await writeAuditLog({
        userId: session.id,
        action: "UPDATE",
        entity: "RecurringMonth",
        entityId: result.monthIds[0] ?? result.contractIds[0] ?? null,
        details: {
          source: "annual_past_years_cleanup",
          selected: ids.length,
          monthsLiquidated: result.monthsLiquidated,
          contractsLiquidated: result.contractsLiquidated,
          skipped: result.skipped,
          openKept: result.openKept,
          openFrom: result.openFrom,
          monthIds: result.monthIds,
          contractIds: result.contractIds,
        },
      });
      revalidatePath("/provvigioni");
      revalidatePath("/backup");
      revalidatePath("/");
    }

    return {
      ok: true,
      monthsLiquidated: result.monthsLiquidated,
      contractsLiquidated: result.contractsLiquidated,
      skipped: result.skipped,
      openKept: result.openKept,
      openFrom: result.openFrom,
    };
  } catch (e) {
    console.error("[applyAnnualPastYearsAction]", e);
    return {
      ok: false,
      error:
        e instanceof Error ? e.message.slice(0, 200) : "Bonifica non riuscita",
    };
  }
}

/**
 * One-shot Admin: esegue l'auto-cleanup completo (idempotente).
 * Preferito da Michele per «sistema direttamente» senza selezione riga-per-riga.
 */
export async function runAnnualPastYearsAutoAction(): Promise<AnnualPastYearsApplyResult> {
  try {
    const session = await requireAnnualCleanupSession();
    const result = await runAnnualPastYearsCleanupAuto({
      changedById: session.id,
    });

    if (result.monthsLiquidated + result.contractsLiquidated > 0) {
      await writeAuditLog({
        userId: session.id,
        action: "UPDATE",
        entity: "RecurringMonth",
        entityId: result.monthIds[0] ?? result.contractIds[0] ?? null,
        details: {
          source: "annual_past_years_cleanup_auto",
          monthsLiquidated: result.monthsLiquidated,
          contractsLiquidated: result.contractsLiquidated,
          skipped: result.skipped,
          openKept: result.openKept,
          openFrom: result.openFrom,
          batches: result.batches,
          done: result.done,
        },
      });
      revalidatePath("/provvigioni");
      revalidatePath("/backup");
      revalidatePath("/");
    }

    return {
      ok: true,
      monthsLiquidated: result.monthsLiquidated,
      contractsLiquidated: result.contractsLiquidated,
      skipped: result.skipped,
      openKept: result.openKept,
      openFrom: result.openFrom ?? ANNUAL_PAST_YEARS_OPEN_FROM,
      done: result.done,
      batches: result.batches,
    };
  } catch (e) {
    console.error("[runAnnualPastYearsAutoAction]", e);
    return {
      ok: false,
      error:
        e instanceof Error
          ? e.message.slice(0, 200)
          : "Bonifica automatica non riuscita",
    };
  }
}
