"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import {
  applyMissingProvvigioniRows,
  scanMissingProvvigioniRows,
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

/** Stessa autorizzazione delle altre manutenzioni dati (solo Admin). */
async function requireBackfillSession() {
  const session = await requireSession();
  if (!hasPermission(session.role, "backup.manage")) {
    throw new Error("Permesso negato: bonifica riservata agli amministratori");
  }
  return session;
}

/** Anteprima a lotti: non scrive nulla. */
export async function scanMissingProvvigioniRowsAction(input?: {
  cursor?: string | null;
}): Promise<BackfillScanActionResult> {
  try {
    await requireBackfillSession();
    const scan = await scanMissingProvvigioniRows({ cursor: input?.cursor ?? null });
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

    if (result.created > 0) {
      await writeAuditLog({
        userId: session.id,
        action: "CREATE",
        entity: "RecurringMonth",
        entityId: null,
        details: {
          source: "backfill_provvigioni_mancanti",
          contracts: result.contracts,
          created: result.created,
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
