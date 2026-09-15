"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import {
  CLEANUP_APPLY_BATCH,
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
  | { ok: true; deleted: number; manualReview: number; contracts: number }
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
 * Applica la bonifica a un lotto di contratti (max `CLEANUP_APPLY_BATCH`).
 * L'intervallo viene ricalcolato lato server: gli id di rata inviati dal
 * client non vengono usati per cancellare.
 */
export async function applyRecurringCleanupAction(input: {
  contractIds: string[];
}): Promise<RecurringCleanupApplyResult> {
  try {
    const session = await requireCleanupSession();
    const ids = [...new Set(input.contractIds ?? [])].filter(Boolean);
    if (ids.length === 0) {
      return { ok: false, error: "Nessun contratto da bonificare" };
    }
    if (ids.length > CLEANUP_APPLY_BATCH) {
      return {
        ok: false,
        error: `Massimo ${CLEANUP_APPLY_BATCH} contratti per lotto`,
      };
    }

    const result = await cleanupRecurringOutOfRange(ids);

    if (result.deleted > 0) {
      await writeAuditLog({
        userId: session.id,
        action: "DELETE",
        entity: "RecurringMonth",
        entityId: ids[0] ?? null,
        details: {
          source: "bonifica_mesi_ricorrenti",
          contracts: ids,
          deleted: result.deleted,
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
