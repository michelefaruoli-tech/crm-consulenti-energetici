"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { mergeDuplicateClientsOnce } from "@/lib/client-dedupe";
import { archiveSupersededPodContracts } from "@/lib/contract-pod-archive";
import { hasPermission } from "@/lib/permissions";

/** Unisce duplicati anagrafica + archivia POD ricontrattualizzati fuori storno. */
export async function cleanupClientDuplicatesAction(): Promise<{
  ok: boolean;
  message: string;
}> {
  const session = await requireSession();
  if (!hasPermission(session.role, "clients.edit_all")) {
    return { ok: false, message: "Solo admin/segreteria" };
  }
  try {
    const merged = await mergeDuplicateClientsOnce();
    const archived = await archiveSupersededPodContracts();
    await writeAuditLog({
      userId: session.id,
      action: "CLEANUP",
      entity: "Client",
      details: { ...merged, ...archived },
    });
    revalidatePath("/clienti");
    revalidatePath("/contratti");
    revalidatePath("/provvigioni");
    revalidatePath("/archivio");
    const parts: string[] = [];
    if (merged.mergedGroups > 0) {
      parts.push(
        `uniti ${merged.mergedGroups} gruppi (${merged.clientsRemoved} anagrafiche)`,
      );
    }
    if (archived.archived > 0) {
      parts.push(`archiviati ${archived.archived} contratti POD precedenti`);
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
