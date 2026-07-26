"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import {
  canConfirmCommission,
  canEditGettoneAmount,
  hasPermission,
} from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { parseFlexibleDate } from "@/lib/date-parse";
import { syncRecurringMonthsForContract } from "@/lib/recurring-sync";
import {
  effectiveGettone,
  operationTypeFromLabel,
} from "@/lib/provvigioni-stato";
import {
  computeSupplyStartDate,
  normalizeOperationType,
} from "@/lib/supply-dates";
import type { Role } from "@/generated/prisma/client";

type SessionLike = { id: string; role: Role };

type CommissionWithContract = {
  id: string;
  contractId: string;
  expected: unknown;
  stornoDate: Date | null;
  stornoAmount: unknown;
  contract: {
    id: string;
    clientId: string;
    collaboratorId: string;
    collectionDate: Date | null;
    insertionDate: Date;
    deletedAt: Date | null;
    client: { type: string };
    supplier: { name: string };
  };
};

async function loadCommission(commissionId: string) {
  return prisma.commission.findUnique({
    where: { id: commissionId },
    include: {
      contract: {
        select: {
          id: true,
          clientId: true,
          collaboratorId: true,
          collectionDate: true,
          insertionDate: true,
          deletedAt: true,
          client: { select: { type: true } },
          supplier: { select: { name: true } },
        },
      },
    },
  });
}

async function applyCommissionField(
  session: SessionLike,
  commission: CommissionWithContract,
  field: string,
  value: string,
): Promise<void> {
  const canAll = hasPermission(session.role, "commissions.view_all");
  if (!canAll && commission.contract.collaboratorId !== session.id) {
    throw new Error("Permesso negato");
  }

  if (field === "expected" || field === "received" || field === "paid" || field === "accrued") {
    const amount = Number(value.replace(",", ".")) || 0;
    if (field === "expected") {
      if (
        !canEditGettoneAmount(
          session.role,
          session.id,
          commission.contract.collaboratorId,
        )
      ) {
        throw new Error("Non puoi modificare il valore gettone");
      }
    } else if (!canAll) {
      throw new Error("Puoi modificare solo il gettone previsto");
    }
    await prisma.commission.update({
      where: { id: commission.id },
      data: { [field]: amount },
    });
    if (field === "expected") {
      const isAdminGettone = hasPermission(session.role, "commissions.edit_gettone");
      await prisma.contract.update({
        where: { id: commission.contractId },
        data: isAdminGettone
          ? { commissionConfirmed: true, commissionConfirmedAt: new Date() }
          : { commissionConfirmed: false, commissionConfirmedAt: null },
      });
      await writeAuditLog({
        userId: session.id,
        action: "UPDATE",
        entity: "Commission",
        entityId: commission.contractId,
        details: {
          field: "expected",
          to: amount,
          confirmed: isAdminGettone,
          source: "provvigioni_table",
        },
      });
    }
  } else if (field === "paymentStatus") {
    const raw = value.trim();
    const paid = /^(incass|s[iì]|si|yes|1)$/i.test(raw);
    const normalized = paid ? "Incassato" : "Da incassare";
    await prisma.contract.update({
      where: { id: commission.contractId },
      data: {
        paymentStatus: normalized,
        collectionDate: paid
          ? commission.contract.collectionDate ?? new Date()
          : null,
      },
    });
    if (paid) {
      await syncRecurringMonthsForContract(commission.contractId).catch(() => undefined);
    }
  } else if (field === "collectionDate") {
    const raw = value.trim();
    if (!raw) {
      await prisma.contract.update({
        where: { id: commission.contractId },
        data: { collectionDate: null, paymentStatus: "Da incassare" },
      });
    } else {
      const d = parseFlexibleDate(raw);
      if (!d) throw new Error("Data non valida (usa MM/AAAA o GG/MM/AAAA)");
      await prisma.contract.update({
        where: { id: commission.contractId },
        data: {
          collectionDate: d,
          paymentStatus: "Incassato",
        },
      });
      await syncRecurringMonthsForContract(commission.contractId).catch(() => undefined);
    }
  } else if (field === "recurrence") {
    const raw = value.trim();
    const normalized = /^r$/i.test(raw) || /ric/i.test(raw)
      ? "Ricorrente"
      : /^g$/i.test(raw) || /ut|tantum|una|gettone/i.test(raw)
        ? "Una tantum"
        : raw || "Una tantum";
    await prisma.contract.update({
      where: { id: commission.contractId },
      data: { recurrence: normalized },
    });
    await syncRecurringMonthsForContract(commission.contractId).catch(() => undefined);
  } else if (field === "operationType") {
    const mapped = operationTypeFromLabel(value);
    // Per date fornitura usiamo la normalizzazione storica (Switch/Voltura/Attivazione)
    const forSupply = normalizeOperationType(mapped);
    const supplyStartDate = computeSupplyStartDate(
      commission.contract.insertionDate,
      forSupply,
    );
    await prisma.contract.update({
      where: { id: commission.contractId },
      data: { operationType: mapped, supplyStartDate },
    });
    await writeAuditLog({
      userId: session.id,
      action: "UPDATE",
      entity: "Contract",
      entityId: commission.contractId,
      details: {
        field: "operationType",
        to: mapped,
        source: "provvigioni_table",
      },
    });
  } else if (field === "storno") {
    const raw = value.trim().toLowerCase();
    const on = /^(s[iì]|si|yes|1|storn)/i.test(raw);
    if (!on) {
      await prisma.commission.update({
        where: { id: commission.id },
        data: { stornoDate: null, stornoAmount: null },
      });
    } else {
      const amount = effectiveGettone({
        expected: Number(commission.expected ?? 0),
        clientType: commission.contract.client.type,
        supplierName: commission.contract.supplier.name,
      });
      await prisma.commission.update({
        where: { id: commission.id },
        data: {
          stornoDate: commission.stornoDate ?? new Date(),
          stornoAmount: amount,
        },
      });
    }
    await writeAuditLog({
      userId: session.id,
      action: "UPDATE",
      entity: "Commission",
      entityId: commission.contractId,
      details: { field: "storno", to: value.trim(), source: "provvigioni_table" },
    });
  } else if (field === "stornoDate") {
    const raw = value.trim();
    if (!raw) {
      await prisma.commission.update({
        where: { id: commission.id },
        data: { stornoDate: null, stornoAmount: null },
      });
    } else {
      const d = parseFlexibleDate(raw);
      if (!d) throw new Error("Data storno non valida (usa MM/AAAA o GG/MM/AAAA)");
      const amount =
        Number(commission.stornoAmount ?? 0) ||
        effectiveGettone({
          expected: Number(commission.expected ?? 0),
          clientType: commission.contract.client.type,
          supplierName: commission.contract.supplier.name,
        });
      await prisma.commission.update({
        where: { id: commission.id },
        data: { stornoDate: d, stornoAmount: amount },
      });
    }
  } else if (field === "stornoAmount") {
    const amount = Number(value.replace(",", ".")) || 0;
    await prisma.commission.update({
      where: { id: commission.id },
      data: {
        stornoAmount: amount,
        stornoDate:
          amount > 0
            ? (commission.stornoDate ?? new Date())
            : null,
      },
    });
  } else if (field === "podPdr") {
    await prisma.contract.update({
      where: { id: commission.contractId },
      data: { podPdr: value.trim() || null },
    });
  } else if (field === "notes") {
    await prisma.contract.update({
      where: { id: commission.contractId },
      data: { notes: value.trim() || null },
    });
  } else if (field === "stato") {
    const raw = value.trim().toLowerCase();
    const contractId = commission.contractId;
    if (/ko|cessat|annull|chius/.test(raw)) {
      await prisma.contract.update({
        where: { id: contractId },
        data: { status: "KO" },
      });
    } else if (/incass/.test(raw) && !/da\s*incass/.test(raw) && !/^no$/.test(raw)) {
      await prisma.contract.update({
        where: { id: contractId },
        data: {
          status: "PAGATO_DAL_FORNITORE",
          paymentStatus: "Incassato",
          collectionDate: commission.contract.collectionDate ?? new Date(),
        },
      });
      await syncRecurringMonthsForContract(contractId).catch(() => undefined);
    } else {
      await prisma.contract.update({
        where: { id: contractId },
        data: {
          status: "IN_ATTESA_PAGAMENTO",
          paymentStatus: "Da incassare",
          collectionDate: null,
        },
      });
    }
    await writeAuditLog({
      userId: session.id,
      action: "UPDATE",
      entity: "Contract",
      entityId: contractId,
      details: { field: "stato", to: value.trim(), source: "provvigioni_table" },
    });
  } else if (field === "collaboratorName") {
    if (!canAll) throw new Error("Solo Admin/Segreteria possono cambiare collaboratore");
    const raw = value.trim();
    const user = await prisma.user.findFirst({
      where: {
        name: { equals: raw, mode: "insensitive" },
        role: { in: ["COLLABORATORE", "COMMERCIALE", "ADMIN", "SEGRETERIA"] },
      },
      select: { id: true },
    });
    if (!user) throw new Error(`Collaboratore non trovato: ${raw}`);
    await prisma.contract.update({
      where: { id: commission.contractId },
      data: { collaboratorId: user.id },
    });
  } else if (field === "supplierName") {
    if (!canAll) throw new Error("Solo Admin/Segreteria possono cambiare fornitore");
    const raw = value.trim();
    const supplier = await prisma.supplier.findFirst({
      where: { name: { equals: raw, mode: "insensitive" } },
      select: { id: true },
    });
    if (!supplier) throw new Error(`Fornitore non trovato: ${raw}`);
    await prisma.contract.update({
      where: { id: commission.contractId },
      data: { supplierId: supplier.id },
    });
  } else if (field === "clientType") {
    const raw = value.trim().toLowerCase();
    const type =
      raw === "bus" ||
      raw.startsWith("bus") ||
      raw.includes("azi") ||
      raw === "b"
        ? "AZIENDA"
        : "PRIVATO";
    await prisma.client.update({
      where: { id: commission.contract.clientId },
      data: { type },
    });
  } else if (field === "clientName") {
    const raw = value.trim();
    if (!raw) throw new Error("Nome cliente vuoto");
    const client = await prisma.client.findUnique({
      where: { id: commission.contract.clientId },
      select: { type: true },
    });
    if (!client) throw new Error("Cliente non trovato");
    if (client.type === "AZIENDA") {
      await prisma.client.update({
        where: { id: commission.contract.clientId },
        data: { companyName: raw },
      });
    } else {
      const parts = raw.split(/\s+/).filter(Boolean);
      const lastName = parts[0] ?? raw;
      const firstName = parts.slice(1).join(" ") || null;
      await prisma.client.update({
        where: { id: commission.contract.clientId },
        data: { lastName, firstName },
      });
    }
  } else if (field === "confirmed") {
    if (!canConfirmCommission(session.role)) {
      throw new Error("Solo Admin o Segreteria possono confermare il gettone");
    }
    const ok = /^(ok|conferm|s[iì]|si|1|true|verde)$/i.test(value.trim());
    await prisma.contract.update({
      where: { id: commission.contractId },
      data: ok
        ? { commissionConfirmed: true, commissionConfirmedAt: new Date() }
        : { commissionConfirmed: false, commissionConfirmedAt: null },
    });
  } else {
    throw new Error(`Campo non modificabile: ${field}`);
  }
}

export async function updateCommissionFieldAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const commissionId = String(formData.get("commissionId") ?? "");
  const field = String(formData.get("field") ?? "");
  const value = String(formData.get("value") ?? "");

  const commission = await loadCommission(commissionId);
  if (!commission) throw new Error("Provvigione non trovata");

  await applyCommissionField(session, commission, field, value);

  revalidatePath("/provvigioni");
  revalidatePath("/");
  revalidatePath("/contratti");
  revalidatePath(`/clienti/${commission.contract.clientId}`);
}

/**
 * Salva insieme molte modifiche cella (bozze dalla tabella Provvigioni).
 * Payload JSON: [{ commissionId, field, value }, ...] — max 500.
 */
export async function bulkUpdateCommissionFieldsAction(
  formData: FormData,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    const raw = String(formData.get("changes") ?? "[]");
    let changes: Array<{ commissionId: string; field: string; value: string }>;
    try {
      changes = JSON.parse(raw) as Array<{
        commissionId: string;
        field: string;
        value: string;
      }>;
    } catch {
      return { ok: false, error: "Dati modifiche non validi" };
    }

    if (!Array.isArray(changes) || changes.length === 0) {
      return { ok: false, error: "Nessuna modifica da salvare" };
    }
    if (changes.length > 500) {
      return { ok: false, error: "Troppe modifiche (max 500). Salva a gruppi." };
    }

    let count = 0;
    const clientIds = new Set<string>();
    for (const ch of changes) {
      const commissionId = String(ch.commissionId ?? "").trim();
      const field = String(ch.field ?? "").trim();
      if (!commissionId || !field) continue;

      const commission = await loadCommission(commissionId);
      if (!commission || commission.contract.deletedAt) continue;

      await applyCommissionField(session, commission, field, String(ch.value ?? ""));
      clientIds.add(commission.contract.clientId);
      count += 1;
    }

    if (count === 0) {
      return { ok: false, error: "Nessuna modifica applicata" };
    }

    revalidatePath("/provvigioni");
    revalidatePath("/");
    revalidatePath("/contratti");
    for (const id of clientIds) revalidatePath(`/clienti/${id}`);

    return { ok: true, count };
  } catch (e) {
    console.error("[bulkUpdateCommissionFieldsAction]", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 200) : "Salvataggio non riuscito",
    };
  }
}

/** Admin/Segreteria conferma il gettone (riga verde). */
export async function confirmCommissionAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!canConfirmCommission(session.role)) {
    throw new Error("Solo Admin o Segreteria possono confermare il gettone");
  }

  const commissionId = String(formData.get("commissionId") ?? "");
  if (!commissionId) throw new Error("Provvigione non specificata");

  const commission = await prisma.commission.findUnique({
    where: { id: commissionId },
    select: { id: true, contractId: true },
  });
  if (!commission) throw new Error("Provvigione non trovata");

  await prisma.contract.update({
    where: { id: commission.contractId },
    data: {
      commissionConfirmed: true,
      commissionConfirmedAt: new Date(),
    },
  });

  await writeAuditLog({
    userId: session.id,
    action: "UPDATE",
    entity: "Contract",
    entityId: commission.contractId,
    details: { field: "commissionConfirmed", to: true, source: "confirm_button" },
  });

  revalidatePath("/provvigioni");
  revalidatePath("/");
  revalidatePath(`/contratti`);
  revalidatePath(`/clienti`);
}

function parseIdList(formData: FormData, key: string): string[] {
  const raw = String(formData.get(key) ?? "");
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

async function assertCanAccessCommissions(
  session: { id: string; role: Parameters<typeof hasPermission>[0] },
  commissionIds: string[],
) {
  if (commissionIds.length === 0) throw new Error("Nessuna riga selezionata");
  if (commissionIds.length > 200) throw new Error("Massimo 200 righe per volta");

  const rows = await prisma.commission.findMany({
    where: { id: { in: commissionIds } },
    select: {
      id: true,
      contractId: true,
      contract: { select: { collaboratorId: true, recurrence: true } },
    },
  });
  if (rows.length === 0) throw new Error("Nessuna provvigione trovata");

  const canAll = hasPermission(session.role, "commissions.view_all");
  for (const r of rows) {
    if (!canAll && r.contract.collaboratorId !== session.id) {
      throw new Error("Permesso negato su una o più righe");
    }
  }
  return rows;
}

/** Segna pagato (collectionDate) su più contratti. */
export async function bulkMarkPaidAction(formData: FormData): Promise<{ ok: true; count: number }> {
  const session = await requireSession();
  const ids = parseIdList(formData, "commissionIds");
  const rows = await assertCanAccessCommissions(session, ids);

  const monthRaw = String(formData.get("collectionMonth") ?? "").trim();
  let collectionDate = new Date();
  if (monthRaw) {
    const d = parseFlexibleDate(monthRaw);
    if (!d) throw new Error("Data non valida (usa MM/AAAA)");
    collectionDate = d;
  }

  for (const r of rows) {
    await prisma.contract.update({
      where: { id: r.contractId },
      data: {
        paymentStatus: "Incassato",
        collectionDate,
      },
    });
  }

  await writeAuditLog({
    userId: session.id,
    action: "UPDATE",
    entity: "Commission",
    entityId: rows[0]?.contractId ?? "",
    details: {
      source: "bulk_mark_paid",
      count: rows.length,
      collectionDate: collectionDate.toISOString().slice(0, 10),
    },
  });

  revalidatePath("/provvigioni");
  revalidatePath("/");
  revalidatePath("/contratti");
  return { ok: true, count: rows.length };
}

/** Conferma gettone (verde) su più contratti — solo Admin/Segreteria. */
export async function bulkConfirmCommissionsAction(
  formData: FormData,
): Promise<{ ok: true; count: number }> {
  const session = await requireSession();
  if (!canConfirmCommission(session.role)) {
    throw new Error("Solo Admin o Segreteria possono confermare il gettone");
  }
  const ids = parseIdList(formData, "commissionIds");
  const rows = await assertCanAccessCommissions(session, ids);
  const now = new Date();

  for (const r of rows) {
    await prisma.contract.update({
      where: { id: r.contractId },
      data: {
        commissionConfirmed: true,
        commissionConfirmedAt: now,
      },
    });
  }

  await writeAuditLog({
    userId: session.id,
    action: "UPDATE",
    entity: "Commission",
    entityId: rows[0]?.contractId ?? "",
    details: { source: "bulk_confirm", count: rows.length },
  });

  revalidatePath("/provvigioni");
  revalidatePath("/");
  revalidatePath("/contratti");
  return { ok: true, count: rows.length };
}

/**
 * Per ogni contratto selezionato ricorrente:
 * - mode=oldest → paga il mese MISSING più vecchio
 * - mode=all → paga tutti i mesi MISSING
 * con settledPeriod = mese del bonifico/rendiconto.
 */
export async function bulkPayRecurringAction(
  formData: FormData,
): Promise<{ ok: true; monthsPaid: number; contracts: number }> {
  const session = await requireSession();
  const ids = parseIdList(formData, "commissionIds");
  const rows = await assertCanAccessCommissions(session, ids);
  const mode = String(formData.get("mode") ?? "oldest");
  const settledRaw = String(formData.get("settledPeriod") ?? "").trim();
  const settledPeriod = /^\d{4}-\d{2}$/.test(settledRaw)
    ? settledRaw
    : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

  let monthsPaid = 0;
  let contractsTouched = 0;

  for (const r of rows) {
    const missing = await prisma.recurringMonth.findMany({
      where: { contractId: r.contractId, status: "MISSING" },
      orderBy: { period: "asc" },
    });
    if (missing.length === 0) continue;

    const toPay = mode === "all" ? missing : [missing[0]];
    contractsTouched += 1;

    for (const m of toPay) {
      await prisma.recurringMonth.update({
        where: { id: m.id },
        data: {
          status: "PAID",
          paidAt: new Date(),
          settledPeriod,
        },
      });
      monthsPaid += 1;
    }

    const latestPaid = await prisma.recurringMonth.findFirst({
      where: { contractId: r.contractId, status: "PAID" },
      orderBy: { period: "desc" },
      select: { period: true },
    });
    if (latestPaid) {
      const [y, mo] = latestPaid.period.split("-").map(Number);
      await prisma.contract.update({
        where: { id: r.contractId },
        data: {
          paymentStatus: "Incassato",
          collectionDate: new Date(y, mo - 1, 1),
        },
      });
    }
    await syncRecurringMonthsForContract(r.contractId).catch(() => undefined);
  }

  await writeAuditLog({
    userId: session.id,
    action: "UPDATE",
    entity: "RecurringMonth",
    entityId: settledPeriod,
    details: {
      source: "bulk_pay_recurring",
      mode,
      settledPeriod,
      monthsPaid,
      contracts: contractsTouched,
    },
  });

  revalidatePath("/provvigioni");
  revalidatePath("/");
  return { ok: true, monthsPaid, contracts: contractsTouched };
}
