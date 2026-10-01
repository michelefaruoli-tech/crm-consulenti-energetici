"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import {
  applyMissingProvvigioniRows,
  scanMissingProvvigioniRows,
  syncRecentRecurringContracts,
  type BackfillApplyResult,
  type MissingProvvigioneRow,
} from "@/lib/recurring-backfill";

export type BackfillScanActionResult =
  | {
      ok: true;
      findings: MissingProvvigioneRow[];
      scannedContracts: number;
      missingContractsCount: number;
      missingPeriodsCount: number;
      nextCursor: string | null;
    }
  | { ok: false; error: string };

export type BackfillApplyActionResult =
  | ({ ok: true } & BackfillApplyResult)
  | { ok: false; error: string };

export type SyncRecentActionResult =
  | {
      ok: true;
      scanned: number;
      synced: number;
      errors: Array<{ contractId: string; message: string }>;
      nextCursor: string | null;
    }
  | { ok: false; error: string };

/** Stessa autorizzazione delle altre manutenzioni dati (solo Admin). */
async function requireBackfillSession() {
  const session = await requireSession();
  if (!hasPermission(session.role, "backup.manage")) {
    throw new Error("Permesso negato: bonifica riservata agli amministratori");
  }
  return session;
}

/** Anteprima a lotti: non scrive nulla. Opzionale filtro ultimi N giorni. */
export async function scanMissingProvvigioniRowsAction(input?: {
  cursor?: string | null;
  /** Es. 30 = solo contratti dell’ultimo mese. */
  insertedSinceDays?: number | null;
}): Promise<BackfillScanActionResult> {
  try {
    await requireBackfillSession();
    const scan = await scanMissingProvvigioniRows({
      cursor: input?.cursor ?? null,
      insertedSinceDays: input?.insertedSinceDays ?? null,
    });
    return { ok: true, ...scan };
  } catch (e) {
    console.error("[scanMissingProvvigioniRowsAction]", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 200) : "Anteprima non riuscita",
    };
  }
}

/** Crea le rate mancanti per i contratti selezionati (mai sovrascrive rate esistenti). */
export async function applyMissingProvvigioniRowsAction(input: {
  contractIds: string[];
}): Promise<BackfillApplyActionResult> {
  try {
    const session = await requireBackfillSession();
    const ids = [...new Set(input.contractIds ?? [])].filter(Boolean);
    if (ids.length === 0) {
      return { ok: false, error: "Nessun contratto selezionato" };
    }

    const result = await applyMissingProvvigioniRows(ids);

    if (result.created > 0 || result.updated > 0) {
      await writeAuditLog({
        userId: session.id,
        action: "CREATE",
        entity: "RecurringMonth",
        entityId: null,
        details: {
          source: "backfill_provvigioni_mancanti",
          contracts: result.contracts,
          created: result.created,
          updated: result.updated,
          rowResults: result.rowResults.slice(0, 50),
          errors: result.errors,
        },
      });
      revalidatePath("/provvigioni");
      revalidatePath("/backup");
    }

    return { ok: true, ...result };
  } catch (e) {
    console.error("[applyMissingProvvigioniRowsAction]", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 200) : "Backfill non riuscito",
    };
  }
}

/**
 * Sync catch-up ultimo mese: richiama sync rate su tutti i ricorrenti
 * inseriti negli ultimi N giorni (idempotente; rispetta lag Helios).
 */
export async function syncRecentRecurringContractsAction(input?: {
  cursor?: string | null;
  days?: number;
}): Promise<SyncRecentActionResult> {
  try {
    const session = await requireBackfillSession();
    const result = await syncRecentRecurringContracts({
      cursor: input?.cursor ?? null,
      days: input?.days ?? 30,
    });

    if (result.synced > 0) {
      await writeAuditLog({
        userId: session.id,
        action: "UPDATE",
        entity: "RecurringMonth",
        entityId: null,
        details: {
          source: "sync_recent_recurring_ultimo_mese",
          days: input?.days ?? 30,
          scanned: result.scanned,
          synced: result.synced,
          errors: result.errors.slice(0, 20),
        },
      });
      revalidatePath("/provvigioni");
      revalidatePath("/backup");
    }

    return { ok: true, ...result };
  } catch (e) {
    console.error("[syncRecentRecurringContractsAction]", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 200) : "Sync recente non riuscito",
    };
  }
}
