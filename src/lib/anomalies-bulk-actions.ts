"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import {
  applyAnomaliesBulk,
  previewAnomaliesBulk,
  type AnomalyBulkApplyRowResult,
  type AnomalyBulkPreview,
} from "@/lib/anomalies-bulk";

async function requireAnomaliesSession() {
  const session = await requireSession();
  const canAll = hasPermission(session.role, "commissions.view_all");
  const canOwn = hasPermission(session.role, "commissions.view_own");
  if (!canAll && !canOwn) {
    throw new Error("Permesso negato");
  }
  // Bonifica massiva (delete + marca pagate): solo chi vede tutte le commissioni
  // (admin / area manager), come le altre manutenzioni dati su Provvigioni.
  if (!canAll) {
    throw new Error(
      "Bonifica anomalie riservata a chi vede tutte le provvigioni (admin)",
    );
  }
  return session;
}

export type PreviewAnomaliesBulkResult =
  | ({ ok: true } & AnomalyBulkPreview)
  | { ok: false; error: string };

/** Anteprima: classifica le rate segnalate. Nessuna scrittura. */
export async function previewAnomaliesBulkAction(input: {
  monthIds: string[];
}): Promise<PreviewAnomaliesBulkResult> {
  try {
    await requireAnomaliesSession();
    const ids = [...new Set(input.monthIds ?? [])].filter(Boolean);
    if (ids.length === 0) {
      return { ok: false, error: "Nessuna rata nell'elenco anomalie" };
    }
    if (ids.length > 500) {
      return { ok: false, error: "Massimo 500 rate per anteprima" };
    }
    const preview = await previewAnomaliesBulk(ids);
    return { ok: true, ...preview };
  } catch (e) {
    console.error("[previewAnomaliesBulkAction]", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 200) : "Anteprima non riuscita",
    };
  }
}

export type ApplyAnomaliesBulkResult =
  | {
      ok: true;
      deleted: number;
      markedPaid: number;
      skipped: number;
      rowResults: AnomalyBulkApplyRowResult[];
    }
  | { ok: false; error: string };

/**
 * Applica: elimina rate prima dell'inizio fornitura e segna PAID le corrette.
 * Ri-verifica ogni id. Richiede conferma UI lato client.
 */
export async function applyAnomaliesBulkAction(input: {
  monthIds: string[];
}): Promise<ApplyAnomaliesBulkResult> {
  try {
    const session = await requireAnomaliesSession();
    const ids = [...new Set(input.monthIds ?? [])].filter(Boolean);
    if (ids.length === 0) {
      return { ok: false, error: "Nessuna rata selezionata" };
    }
    if (ids.length > 500) {
      return { ok: false, error: "Massimo 500 rate per lotto" };
    }

    const result = await applyAnomaliesBulk(ids);

    if (result.deleted > 0 || result.markedPaid > 0) {
      await writeAuditLog({
        userId: session.id,
        action: "UPDATE",
        entity: "RecurringMonth",
        entityId: null,
        details: {
          source: "provvigioni_anomalie_bonifica_massiva",
          selected: ids.length,
          deleted: result.deleted,
          markedPaid: result.markedPaid,
          skipped: result.skipped,
        },
      });
      revalidatePath("/provvigioni");
      revalidatePath("/backup");
    }

    return { ok: true, ...result };
  } catch (e) {
    console.error("[applyAnomaliesBulkAction]", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 200) : "Bonifica non riuscita",
    };
  }
}
