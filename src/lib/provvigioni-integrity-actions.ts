"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import {
  applyEarlyRecurringCleanup,
  applyPodDuplicateArchive,
  checkProvvigioniTotals,
  scanPodDuplicateAnomalies,
  scanRecurringAnomalies,
  type IntegrityRowFinding,
  type RecurringAnomalyScan,
} from "@/lib/provvigioni-integrity-scan";
import type {
  PodDuplicateFinding,
  TotalsConsistencyResult,
} from "@/lib/provvigioni-integrity";

/** Stessa autorizzazione delle altre manutenzioni dati (solo Admin). */
async function requireIntegritySession() {
  const session = await requireSession();
  if (!hasPermission(session.role, "backup.manage")) {
    throw new Error("Permesso negato: controllo riservato agli amministratori");
  }
  return session;
}

export type ScanRecurringAnomaliesResult =
  | ({ ok: true } & RecurringAnomalyScan)
  | { ok: false; error: string };

/** Anteprima a lotti: non scrive nulla. */
export async function scanRecurringAnomaliesAction(input?: {
  cursor?: string | null;
}): Promise<ScanRecurringAnomaliesResult> {
  try {
    await requireIntegritySession();
    const scan = await scanRecurringAnomalies({ cursor: input?.cursor ?? null });
    return { ok: true, ...scan };
  } catch (e) {
    console.error("[scanRecurringAnomaliesAction]", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 200) : "Anteprima non riuscita",
    };
  }
}

export type ScanPodDuplicatesResult =
  | { ok: true; findings: PodDuplicateFinding[]; scannedContracts: number; truncated: boolean }
  | { ok: false; error: string };

/** Anteprima repliche POD non gestite: un solo giro, non scrive nulla. */
export async function scanPodDuplicateAnomaliesAction(): Promise<ScanPodDuplicatesResult> {
  try {
    await requireIntegritySession();
    const scan = await scanPodDuplicateAnomalies();
    return { ok: true, ...scan };
  } catch (e) {
    console.error("[scanPodDuplicateAnomaliesAction]", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 200) : "Anteprima non riuscita",
    };
  }
}

export type ApplyEarlyRecurringCleanupResult =
  | { ok: true; deleted: number; rejected: number }
  | { ok: false; error: string };

/**
 * Elimina rate create in anticipo (mensili oltre il mese generabile, annuali
 * prima del 13° mese) selezionate dall'anteprima. Ri-verifica ogni id prima
 * di eliminare: mai una rata con incasso/rendiconto.
 */
export async function applyEarlyRecurringCleanupAction(input: {
  monthIds: string[];
}): Promise<ApplyEarlyRecurringCleanupResult> {
  try {
    const session = await requireIntegritySession();
    const ids = [...new Set(input.monthIds ?? [])].filter(Boolean);
    if (ids.length === 0) {
      return { ok: false, error: "Nessuna rata selezionata" };
    }
    if (ids.length > 200) {
      return { ok: false, error: "Massimo 200 rate per lotto" };
    }

    const result = await applyEarlyRecurringCleanup(ids);

    if (result.deleted > 0) {
      await writeAuditLog({
        userId: session.id,
        action: "DELETE",
        entity: "RecurringMonth",
        entityId: null,
        details: {
          source: "controllo_integrita_provvigioni_rate_anticipo",
          selected: ids.length,
          deleted: result.deleted,
          rejected: result.rejected,
        },
      });
      revalidatePath("/provvigioni");
      revalidatePath("/backup");
    }

    return { ok: true, ...result };
  } catch (e) {
    console.error("[applyEarlyRecurringCleanupAction]", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 200) : "Bonifica non riuscita",
    };
  }
}

export type ApplyPodDuplicateArchiveResult =
  | { ok: true; archived: number; keptMonthly: number; keptForStorno: number }
  | { ok: false; error: string };

/**
 * Applica l'archiviazione per i POD selezionati (delega ad
 * `archiveSupersededPodContracts`, la stessa funzione usata alla creazione
 * di un nuovo contratto): in storno resta com'è, fuori storno archivia,
 * mensile ricorrente resta attivo fino al nuovo ingresso in fornitura.
 */
export async function applyPodDuplicateArchiveAction(input: {
  podKeys: string[];
}): Promise<ApplyPodDuplicateArchiveResult> {
  try {
    const session = await requireIntegritySession();
    const keys = [...new Set(input.podKeys ?? [])].filter(Boolean);
    if (keys.length === 0) {
      return { ok: false, error: "Nessun POD selezionato" };
    }
    if (keys.length > 100) {
      return { ok: false, error: "Massimo 100 POD per lotto" };
    }

    const result = await applyPodDuplicateArchive(keys);

    if (result.archived > 0) {
      await writeAuditLog({
        userId: session.id,
        action: "UPDATE",
        entity: "Contract",
        entityId: null,
        details: {
          source: "controllo_integrita_provvigioni_repliche_pod",
          podSelezionati: keys.length,
          archiviati: result.archived,
          mensiliInAttesa: result.keptMonthly,
          restatiPerStorno: result.keptForStorno,
        },
      });
      revalidatePath("/provvigioni");
      revalidatePath("/contratti");
      revalidatePath("/backup");
    }

    return { ok: true, ...result };
  } catch (e) {
    console.error("[applyPodDuplicateArchiveAction]", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 200) : "Archiviazione non riuscita",
    };
  }
}

export type CheckTotalsResult =
  | {
      ok: true;
      results: TotalsConsistencyResult[];
      scannedContracts: number;
      truncated: boolean;
    }
  | { ok: false; error: string };

/** Verifica di sola lettura: card/totali vs somma indipendente delle righe. */
export async function checkProvvigioniTotalsAction(input?: {
  collaboratorId?: string | null;
  supplierName?: string | null;
}): Promise<CheckTotalsResult> {
  try {
    const session = await requireIntegritySession();
    const check = await checkProvvigioniTotals({
      sessionUserId: session.id,
      collaboratorId: input?.collaboratorId ?? null,
      supplierName: input?.supplierName ?? null,
    });
    return { ok: true, ...check };
  } catch (e) {
    console.error("[checkProvvigioniTotalsAction]", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 200) : "Verifica non riuscita",
    };
  }
}

export type { IntegrityRowFinding, PodDuplicateFinding, TotalsConsistencyResult };
