"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { mergeDuplicateClientsOnce } from "@/lib/client-dedupe";
import {
  archiveSupersededPodContracts,
  reactivateImportedHistoricalContracts,
} from "@/lib/contract-pod-archive";
import { hasPermission } from "@/lib/permissions";

/**
 * 1) Riattiva contratti importati nascosti da Provvigioni
 * 2) Unisce anagrafiche duplicate
 * 3) Archivia POD ricontrattualizzati (precedenti)
 */
export async function cleanupClientDuplicatesAction(): Promise<{
  ok: boolean;
  message: string;
}> {
  const session = await requireSession();
  if (!hasPermission(session.role, "clients.edit_all")) {
    return { ok: false, message: "Solo admin/segreteria" };
  }
  try {
    const reactivated = await reactivateImportedHistoricalContracts();
    const merged = await mergeDuplicateClientsOnce();
    const archived = await archiveSupersededPodContracts();
    await writeAuditLog({
      userId: session.id,
      action: "CLEANUP",
      entity: "Client",
      details: { ...reactivated, ...merged, ...archived },
    });
    revalidatePath("/clienti");
    revalidatePath("/contratti");
    revalidatePath("/provvigioni");
    revalidatePath("/archivio");
    const parts: string[] = [];
    if (reactivated.reactivated > 0) {
      parts.push(
        `riattivati ${reactivated.reactivated} contratti (ora visibili in Provvigioni)`,
      );
    }
    if (merged.mergedGroups > 0) {
      parts.push(
        `uniti ${merged.mergedGroups} gruppi (${merged.clientsRemoved} anagrafiche)`,
      );
    }
    if (archived.archived > 0) {
      parts.push(`archiviati ${archived.archived} POD precedenti`);
    }
    return {
      ok: true,
      message: parts.length ? parts.join(" · ") : "Nessuna modifica necessaria",
    };
  } catch (e) {
    console.error("[cleanupClientDuplicatesAction]", e);
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Errore pulizia",
    };
  }
}
