"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import {
  CLEANUP_APPLY_MONTH_BATCH,
  CLEANUP_SCAN_BATCH,
  cleanupRecurringOutOfRange,
  scanRecurringOutOfRange,
  type ContractCleanupFinding,
} from "@/lib/recurring-cleanup";

export type RecurringCleanupScanResult =
  | {
      ok: true;
      findings: ContractCleanupFinding[];
      scannedContracts: number;
      scannedMonths: number;
      removableCount: number;
      manualCount: number;
      nextCursor: string | null;
    }
  | { ok: false; error: string };

export type RecurringCleanupApplyResult =
  | {
      ok: true;
      deleted: number;
      manualReview: number;
      contracts: number;
      monthIds: string[];
    }
  | { ok: false; error: string };

/** Stessa autorizzazione delle altre manutenzioni dati (solo Admin). */
async function requireCleanupSession() {
  const session = await requireSession();
  if (!hasPermission(session.role, "backup.manage")) {
    throw new Error("Permesso negato: bonifica riservata agli amministratori");
  }
  return session;
}

/**
 * Anteprima a lotti: non scrive nulla.
 * Il client richiama passando `nextCursor` finché non torna null, così ogni
 * richiesta resta ben dentro il limite di durata delle funzioni serverless.
 */
export async function scanRecurringCleanupAction(input?: {
  cursor?: string | null;
  batchSize?: number;
}): Promise<RecurringCleanupScanResult> {
  try {
    await requireCleanupSession();
    const batchSize = Math.min(
      Math.max(Number(input?.batchSize) || CLEANUP_SCAN_BATCH, 10),
      CLEANUP_SCAN_BATCH,
    );
    const scan = await scanRecurringOutOfRange({
      cursor: input?.cursor ?? null,
      batchSize,
    });
    return { ok: true, ...scan };
  } catch (e) {
    console.error("[scanRecurringCleanupAction]", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 200) : "Anteprima non riuscita",
    };
  }
}

/**
 * Applica la bonifica a un lotto di rate selezionate (max
 * `CLEANUP_APPLY_MONTH_BATCH`). L'intervallo viene ricalcolato lato server e
 * ogni id deve risultare rimovibile; rate protette o assenti vengono rifiutate.
 */
export async function applyRecurringCleanupAction(input: {
  monthIds: string[];
}): Promise<RecurringCleanupApplyResult> {
  try {
    const session = await requireCleanupSession();
    const ids = [...new Set(input.monthIds ?? [])].filter(Boolean);
    if (ids.length === 0) {
      return { ok: false, error: "Nessuna rata selezionata da rimuovere" };
    }
    if (ids.length > CLEANUP_APPLY_MONTH_BATCH) {
      return {
        ok: false,
        error: `Massimo ${CLEANUP_APPLY_MONTH_BATCH} rate per lotto`,
      };
    }

    const result = await cleanupRecurringOutOfRange([], { onlyMonthIds: ids });

    if (result.deleted > 0) {
      await writeAuditLog({
        userId: session.id,
        action: "DELETE",
        entity: "RecurringMonth",
        entityId: result.monthIds[0] ?? null,
        details: {
          source: "bonifica_mesi_ricorrenti",
          selected: ids.length,
          deleted: result.deleted,
          monthIds: result.monthIds,
          manualReview: result.manualReview,
        },
      });
      revalidatePath("/provvigioni");
      revalidatePath("/backup");
    }

    return { ok: true, ...result };
  } catch (e) {
    console.error("[applyRecurringCleanupAction]", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 200) : "Bonifica non riuscita",
    };
  }
}
