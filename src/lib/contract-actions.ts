"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { parseFlexibleDate } from "@/lib/date-parse";
import {
  computeSupplyStartDate,
  fixSwitchEqualInsertionSupply,
  normalizeOperationType,
} from "@/lib/supply-dates";
import { CONTRACT_STATUS_LABELS, type AppContractStatus } from "@/lib/constants";
import { notifyCollaboratorStatusChange } from "@/lib/notify-collaborator-status";
import { reactivateContractFields } from "@/lib/contract-reactivate";

function statusFromLabel(value: string): AppContractStatus | null {
  const raw = value.trim();
  if (!raw) return null;
  const upper = raw.toUpperCase().replace(/\s+/g, "_");
  const keys = Object.keys(CONTRACT_STATUS_LABELS) as AppContractStatus[];
  if (keys.includes(upper as AppContractStatus)) return upper as AppContractStatus;
  const found = keys.find(
    (k) => CONTRACT_STATUS_LABELS[k].toLowerCase() === raw.toLowerCase(),
  );
  return found ?? null;
}

function publicActionError(e: unknown): string {
  const msg = e instanceof Error ? e.message : "Salvataggio non riuscito";
  if (msg.includes("HTTP mode") || msg.includes("Transaction")) {
    return "Errore database. Riprova tra qualche secondo.";
  }
  return msg.slice(0, 220);
}

type Session = Awaited<ReturnType<typeof requireSession>>;

async function applyContractFieldUpdate(
  formData: FormData,
  options?: { skipRevalidate?: boolean; session?: Session },
): Promise<void> {
  const session = options?.session ?? (await requireSession());
  const skipRevalidate = options?.skipRevalidate === true;
  const revalidate = (path: string) => {
    if (!skipRevalidate) revalidatePath(path);
  };
  const contractId = String(formData.get("contractId") ?? "");
  const field = String(formData.get("field") ?? "");
  const value = String(formData.get("value") ?? "");

  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract) throw new Error("Contratto non trovato");

  const canAll = hasPermission(session.role, "contracts.edit_all");
  const isOwner = contract.collaboratorId === session.id;

  // Cambio stato: chi ha contracts.change_status e può vedere il contratto
  // (Admin/Segreteria, Backoffice/Area Manager nello scope, o proprietario).
  if (field === "status") {
    if (!hasPermission(session.role, "contracts.change_status")) {
      throw new Error("Non puoi cambiare lo stato");
    }
    const { userCanAccessContract } = await import("@/lib/user-scope");
    if (!(await userCanAccessContract(session, contract))) {
      throw new Error("Permesso negato");
    }
  } else if (!canAll && !isOwner) {
    throw new Error("Permesso negato");
  }

  if (field === "podPdr") {
    await prisma.contract.update({
      where: { id: contractId },
      data: { podPdr: value.trim() || null },
    });
  } else if (field === "operationType") {
    const op = normalizeOperationType(value);
    const supplyStartDate = computeSupplyStartDate(contract.insertionDate, op);
    await prisma.contract.update({
      where: { id: contractId },
      data: { operationType: op, supplyStartDate },
    });
  } else if (field === "supplyStartDate") {
    const d = parseFlexibleDate(value);
    if (!d) throw new Error("Data non valida (usa GG/MM/AAAA)");
    const op = normalizeOperationType(contract.operationType);
    const fixed = fixSwitchEqualInsertionSupply(
      contract.insertionDate ?? d,
      d,
      op,
    );
    await prisma.contract.update({
      where: { id: contractId },
      data: {
        supplyStartDate: fixed.supplyStartDate,
        insertionDate: fixed.insertionDate,
      },
    });
  } else if (field === "insertionDate") {
    const d = parseFlexibleDate(value);
    if (!d) throw new Error("Data non valida (usa GG/MM/AAAA)");
    const op = normalizeOperationType(contract.operationType);
    // Se c’è già una fornitura segnata, la teniamo e sistemiamo solo se Switch uguali
    if (contract.supplyStartDate) {
      const fixed = fixSwitchEqualInsertionSupply(
        d,
        contract.supplyStartDate,
        op,
      );
      await prisma.contract.update({
        where: { id: contractId },
        data: {
          insertionDate: fixed.insertionDate,
          supplyStartDate: fixed.supplyStartDate,
        },
      });
    } else {
      await prisma.contract.update({
        where: { id: contractId },
        data: {
          insertionDate: d,
          supplyStartDate: computeSupplyStartDate(d, op),
        },
      });
    }
  } else if (field === "status") {
    // Permesso già verificato sopra
    const status = statusFromLabel(value);
    if (!status) throw new Error("Stato non riconosciuto");
    const terminal = ["CHIUSO", "KO", "ANNULLATO"].includes(status);
    const closureDateRaw = String(formData.get("closureDate") ?? "").trim();
    const closureReason = String(formData.get("closureReason") ?? "").trim();
    const closureNotes = String(formData.get("closureNotes") ?? "").trim();
    const agentNotes = String(formData.get("agentNotes") ?? "").trim() || closureNotes;
    const notifyStatuses = ["IN_ATTESA_PAGAMENTO", "DOCUMENTAZIONE_INCOMPLETA", "KO"];
    if (notifyStatuses.includes(status) && status !== contract.status && !agentNotes) {
      throw new Error("Inserisci le note per l’agente prima di salvare");
    }
    const closureDate = terminal ? parseFlexibleDate(closureDateRaw) : null;
    if (terminal && !closureDate) throw new Error("Data chiusura obbligatoria");
    if (terminal && !closureReason && status !== "KO") {
      throw new Error("Motivo chiusura obbligatorio");
    }
    // KO da lista Master: motivo di default se non passato
    const resolvedClosureReason =
      closureReason ||
      (status === "KO" ? "Esito Back Office" : "");
    if (terminal && !resolvedClosureReason) {
      throw new Error("Motivo chiusura obbligatorio");
    }
    const fromStatus = contract.status;
    const leavingTerminal =
      ["CHIUSO", "KO", "ANNULLATO"].includes(fromStatus) && !terminal;
    await prisma.contract.update({
      where: { id: contractId },
      data: {
        status,
        ...(agentNotes
          ? { notes: agentNotes, workNotes: agentNotes }
          : {}),
        ...(status === "IN_ATTESA_PAGAMENTO"
          ? {
              paymentStatus: "Da incassare",
              collectionDate: null,
              workCompletedAt: new Date(),
              workStatus: "IN_ATTESA_PAGAMENTO",
            }
          : {}),
        ...(status === "DOCUMENTAZIONE_INCOMPLETA"
          ? {
              workStatus: "DOCUMENTAZIONE_INCOMPLETA",
              koNotes: agentNotes || null,
            }
          : {}),
        ...(status === "KO" || status === "ANNULLATO"
          ? {
              koReason: resolvedClosureReason,
              koNotes: agentNotes || closureNotes || null,
            }
          : {}),
        ...(leavingTerminal || contract.isHistorical
          ? reactivateContractFields()
          : {}),
      },
    });
    await prisma.contractStatusHistory.create({
      data: {
        contractId,
        fromStatus,
        toStatus: status,
        changedById: session.id,
        changedAt: closureDate ?? new Date(),
        note: agentNotes || closureNotes || "Modifica da elenco",
        changeReason: resolvedClosureReason || null,
        koReason:
          status === "KO" || status === "ANNULLATO" ? resolvedClosureReason : null,
      },
    });
    if (terminal) {
      const { syncRecurringMonthsForContract } = await import("@/lib/recurring-sync");
      await syncRecurringMonthsForContract(contractId);
    }
    await notifyCollaboratorStatusChange({
      contractId,
      fromStatus,
      toStatus: status,
      changedByName: session.name,
      note: agentNotes || closureNotes || closureReason || null,
      detailNotes: agentNotes || closureNotes || null,
    });
    revalidate("/");
    revalidate("/contratti");
    revalidate("/lavorazione");
    revalidate("/provvigioni");
    revalidate(`/contratti/${contractId}`);
    revalidate(`/lavorazione/${contractId}`);
  } else if (field === "notes") {
    await prisma.contract.update({
      where: { id: contractId },
      data: { notes: value.trim() || null },
    });
  } else if (field === "collaboratorId") {
    if (!hasPermission(session.role, "contracts.change_collaborator_dashboard")) {
      throw new Error("Non puoi cambiare il collaboratore");
    }
    const collaboratorId = value.trim();
    if (!collaboratorId) throw new Error("Collaboratore mancante");
    const collaborator = await prisma.user.findFirst({
      where: {
        id: collaboratorId,
        role: { in: ["COLLABORATORE", "COMMERCIALE", "AREA_MANAGER", "ADMIN", "SEGRETERIA"] },
      },
      select: { id: true, name: true, active: true },
    });
    if (!collaborator) throw new Error("Collaboratore non valido");
    if (!collaborator.active && collaborator.id !== contract.collaboratorId) {
      throw new Error("Collaboratore non attivo");
    }
    if (collaborator.id === contract.collaboratorId) return;

    const previous = await prisma.user.findUnique({
      where: { id: contract.collaboratorId },
      select: { name: true },
    });

    await prisma.contract.update({
      where: { id: contractId },
      data: { collaboratorId: collaborator.id },
    });
    await prisma.auditLog.create({
      data: {
        userId: session.id,
        action: "UPDATE",
        entity: "Contract",
        entityId: contractId,
        details: JSON.stringify({
          field: "collaboratorId",
          from: contract.collaboratorId,
          fromName: previous?.name ?? null,
          to: collaborator.id,
          toName: collaborator.name,
          source: "dashboard_list",
        }),
      },
    });
  } else {
    throw new Error("Campo non modificabile");
  }

  revalidate("/contratti");
  revalidate(`/contratti/${contractId}`);
  revalidate("/");
  revalidate("/archivio");
}

export async function updateContractFieldAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await applyContractFieldUpdate(formData);
    return { ok: true };
  } catch (e) {
    console.error("[updateContractFieldAction]", e);
    return { ok: false, error: publicActionError(e) };
  }
}

const BULK_STATUS_LIMIT = 50;

/** Aggiorna più stati in una sola richiesta (dashboard elenco lavorazioni). */
export async function updateContractStatusesBulkAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; updated: number }> {
  let updated = 0;
  try {
    const session = await requireSession();
    const ids = formData.getAll("contractId").map((v) => String(v).trim());
    const statuses = formData.getAll("status").map((v) => String(v).trim());
    if (ids.length === 0) return { ok: false, error: "Nessuna modifica da salvare", updated: 0 };
    if (ids.length !== statuses.length) {
      return { ok: false, error: "Dati non validi", updated: 0 };
    }
    if (ids.length > BULK_STATUS_LIMIT) {
      return {
        ok: false,
        error: `Massimo ${BULK_STATUS_LIMIT} pratiche per salvataggio`,
        updated: 0,
      };
    }

    const agentNotes = String(formData.get("agentNotes") ?? "").trim();
    const closureDate = String(formData.get("closureDate") ?? "").trim();
    const closureReason = String(formData.get("closureReason") ?? "").trim();
    const closureNotes = String(formData.get("closureNotes") ?? "").trim();

    for (let i = 0; i < ids.length; i++) {
      const contractId = ids[i];
      const value = statuses[i];
      if (!contractId || !value) {
        return { ok: false, error: "Dati non validi", updated };
      }
      const fd = new FormData();
      fd.set("contractId", contractId);
      fd.set("field", "status");
      fd.set("value", value);
      if (agentNotes) fd.set("agentNotes", agentNotes);
      if (closureDate) fd.set("closureDate", closureDate);
      if (closureReason) fd.set("closureReason", closureReason);
      if (closureNotes) fd.set("closureNotes", closureNotes);
      await applyContractFieldUpdate(fd, { skipRevalidate: true, session });
      updated += 1;
    }

    revalidatePath("/");
    revalidatePath("/contratti");
    revalidatePath("/lavorazione");
    revalidatePath("/provvigioni");
    revalidatePath("/archivio");
    return { ok: true, updated };
  } catch (e) {
    console.error("[updateContractStatusesBulkAction]", e);
    if (updated > 0) {
      revalidatePath("/");
      revalidatePath("/lavorazione");
      revalidatePath("/contratti");
      revalidatePath("/provvigioni");
    }
    return { ok: false, error: publicActionError(e), updated };
  }
}
