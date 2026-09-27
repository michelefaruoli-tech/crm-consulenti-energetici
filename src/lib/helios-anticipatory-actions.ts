"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import {
  HELIOS_ANTICIPATORY_APPLY_BATCH,
  HELIOS_ANTICIPATORY_SCAN_BATCH,
  applyHeliosAnticipatoryCleanup,
  scanHeliosAnticipatoryRates,
  type HeliosAnticipatoryRow,
} from "@/lib/helios-anticipatory-cleanup";
import { periodLabel } from "@/lib/recurring";

export type HeliosAnticipatoryScanResult =
  | {
      ok: true;
      rows: HeliosAnticipatoryRow[];
      lastPayableCompetence: string;
      lastPayableLabel: string;
      scannedMonths: number;
      nextCursor: string | null;
    }
  | { ok: false; error: string };

export type HeliosAnticipatoryApplyResult =
  | {
      ok: true;
      closed: number;
      deleted: number;
      skipped: number;
      monthIds: string[];
      lastPayableCompetence: string;
    }
  | { ok: false; error: string };

async function requireHeliosCleanupSession() {
  const session = await requireSession();
  if (session.role !== "ADMIN" && !hasPermission(session.role, "backup.manage")) {
    throw new Error("Permesso negato: bonifica Helios riservata agli amministratori");
  }
  return session;
}

/** Anteprima a lotti: nessuna scrittura. */
export async function scanHeliosAnticipatoryAction(input?: {
  cursor?: string | null;
  batchSize?: number;
}): Promise<HeliosAnticipatoryScanResult> {
  try {
    await requireHeliosCleanupSession();
    const batchSize = Math.min(
      Math.max(Number(input?.batchSize) || HELIOS_ANTICIPATORY_SCAN_BATCH, 10),
      HELIOS_ANTICIPATORY_SCAN_BATCH,
    );
    const scan = await scanHeliosAnticipatoryRates({
      cursor: input?.cursor ?? null,
      batchSize,
    });
    return {
      ok: true,
      rows: scan.rows,
      lastPayableCompetence: scan.lastPayableCompetence,
      lastPayableLabel: periodLabel(scan.lastPayableCompetence),
      scannedMonths: scan.scannedMonths,
      nextCursor: scan.nextCursor,
    };
  } catch (e) {
    console.error("[scanHeliosAnticipatoryAction]", e);
    return {
      ok: false,
      error:
        e instanceof Error ? e.message.slice(0, 200) : "Anteprima non riuscita",
    };
  }
}

/** Applica chiusura/eliminazione sulle rate selezionate (max lotto). */
export async function applyHeliosAnticipatoryAction(input: {
  monthIds: string[];
}): Promise<HeliosAnticipatoryApplyResult> {
  try {
    const session = await requireHeliosCleanupSession();
    const ids = [...new Set(input.monthIds ?? [])].filter(Boolean);
    if (ids.length === 0) {
      return { ok: false, error: "Nessuna rata selezionata" };
    }
    if (ids.length > HELIOS_ANTICIPATORY_APPLY_BATCH) {
      return {
        ok: false,
        error: `Massimo ${HELIOS_ANTICIPATORY_APPLY_BATCH} rate per lotto`,
      };
    }

    const result = await applyHeliosAnticipatoryCleanup({ monthIds: ids });

    if (result.closed + result.deleted > 0) {
      await writeAuditLog({
        userId: session.id,
        action: "UPDATE",
        entity: "RecurringMonth",
        entityId: result.monthIds[0] ?? null,
        details: {
          source: "helios_anticipatory_cleanup",
          selected: ids.length,
          closed: result.closed,
          deleted: result.deleted,
          skipped: result.skipped,
          lastPayableCompetence: result.lastPayableCompetence,
          monthIds: result.monthIds,
        },
      });
      revalidatePath("/provvigioni");
      revalidatePath("/provvigioni/liquidazioni");
      revalidatePath("/backup");
      revalidatePath("/");
    }

    return { ok: true, ...result };
  } catch (e) {
    console.error("[applyHeliosAnticipatoryAction]", e);
    return {
      ok: false,
      error:
        e instanceof Error ? e.message.slice(0, 200) : "Bonifica non riuscita",
    };
  }
}
