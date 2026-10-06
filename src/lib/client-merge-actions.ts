"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { mergeClientIntoKeeper } from "@/lib/client-dedupe";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma/client";
import { clientVisibilityWhere } from "@/lib/user-scope";

async function assertCanEditClient(
  session: { id: string; role: Role },
  clientId: string,
): Promise<void> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, deletedAt: null },
    select: { id: true, createdById: true },
  });
  if (!client) throw new Error("Cliente non trovato");

  const canEditAll = hasPermission(session.role, "clients.edit_all");
  if (canEditAll || client.createdById === session.id) return;

  const linked = await prisma.contract.findFirst({
    where: {
      clientId,
      collaboratorId: session.id,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!linked) throw new Error("Permesso negato sull’anagrafica corrente");
}

async function assertClientInScope(
  session: { id: string; role: Role },
  clientId: string,
): Promise<void> {
  const visibility = await clientVisibilityWhere(session);
  const found = await prisma.client.findFirst({
    where: { id: clientId, deletedAt: null, ...visibility },
    select: { id: true },
  });
  if (!found) {
    throw new Error("Anagrafica fuori dal tuo perimetro");
  }
}

/**
 * Unifica l’anagrafica `sourceClientId` sotto quella già registrata `targetClientId`.
 * Sposta i contratti e soft-delete la fonte (nessun duplicato).
 */
export async function mergeClientIntoAction(
  sourceClientId: string,
  targetClientId: string,
): Promise<{
  ok: boolean;
  message: string;
  redirectTo?: string;
}> {
  const session = await requireSession();
  const sourceId = String(sourceClientId ?? "").trim();
  const targetId = String(targetClientId ?? "").trim();
  if (!sourceId || !targetId) {
    return { ok: false, message: "Seleziona un’anagrafica esistente" };
  }
  if (sourceId === targetId) {
    return { ok: false, message: "Seleziona un’anagrafica diversa da quella corrente" };
  }

  try {
    await assertCanEditClient(session, sourceId);
    await assertClientInScope(session, sourceId);
    await assertClientInScope(session, targetId);

    const result = await mergeClientIntoKeeper(sourceId, targetId);

    await writeAuditLog({
      userId: session.id,
      action: "MERGE",
      entity: "Client",
      entityId: targetId,
      details: {
        sourceId,
        targetId,
        contractsMoved: result.contractsMoved,
        documentsMoved: result.documentsMoved,
        agendaMoved: result.agendaMoved,
      },
    });

    revalidatePath("/clienti");
    revalidatePath(`/clienti/${sourceId}`);
    revalidatePath(`/clienti/${targetId}`);
    revalidatePath("/contratti");
    revalidatePath("/provvigioni");

    const n = result.contractsMoved;
    return {
      ok: true,
      message:
        n === 0
          ? "Anagrafica unificata (nessun contratto da spostare)"
          : `Unificati ${n} contrat${n === 1 ? "to" : "ti"} sotto l’anagrafica esistente`,
      redirectTo: `/clienti/${targetId}`,
    };
  } catch (e) {
    console.error("[mergeClientIntoAction]", e);
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Errore unificazione anagrafica",
    };
  }
}
