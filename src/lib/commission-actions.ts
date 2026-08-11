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
  fixFutureDatesForPayment,
  fixSwitchEqualInsertionSupply,
  normalizeOperationType,
} from "@/lib/supply-dates";
import { buildProvvigioniContractWhere } from "@/lib/provvigioni-filters";
import { contractVisibilityWhere } from "@/lib/user-scope";
import type { Role } from "@/generated/prisma/client";
import { parsePrivatoDisplayName } from "@/lib/utils";

type SessionLike = { id: string; role: Role };

type CommissionWithContract = {
  id: string;
  contractId: string;
  expected: unknown;
  received: unknown;
  paid: unknown;
  stornoDate: Date | null;
  stornoAmount: unknown;
  contract: {
    id: string;
    clientId: string;
    collaboratorId: string;
    collectionDate: Date | null;
    insertionDate: Date;
    operationType: string | null;
    supplyStartDate: Date | null;
    status: string;
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
          operationType: true,
          supplyStartDate: true,
          status: true,
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
      data:
        field === "expected"
          ? {
              expected: amount,
              // Allinea received al gettone modificato (evita Report/liquidazione con importo vecchio)
              received: amount,
            }
          : { [field]: amount },
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
      const amount = Number(commission.expected ?? 0) || 0;
      await prisma.commission.update({
        where: { id: commission.id },
        data: { received: amount, accrued: amount },
      });
      await syncRecurringMonthsForContract(commission.contractId).catch(() => undefined);
    }
  } else if (field === "collectionDate") {
    const raw = value.trim();
    const terminal = ["KO", "ANNULLATO", "CHIUSO"].includes(commission.contract.status);
    if (!raw) {
      await prisma.contract.update({
        where: { id: commission.contractId },
        data: {
          collectionDate: null,
          paymentStatus: "Da incassare",
          ...(terminal || commission.contract.status === "PROVVIGIONE_LIQUIDATA"
            ? {}
            : { status: "IN_ATTESA_PAGAMENTO" }),
        },
      });
    } else {
      const d = parseFlexibleDate(raw);
      if (!d) throw new Error("Data non valida (usa MM/AAAA o GG/MM/AAAA)");
      // Se inserimento/fornitura sono future (errore), anticipa inserimento di 1 mese
      // altrimenti la pagina Provvigioni cancellerebbe subito l’incasso.
      const dates = fixFutureDatesForPayment({
        insertionDate: commission.contract.insertionDate,
        supplyStartDate: commission.contract.supplyStartDate,
        operationType: commission.contract.operationType,
      });
      await prisma.contract.update({
        where: { id: commission.contractId },
        data: {
          collectionDate: d,
          paymentStatus: "Incassato",
          ...(terminal ? {} : { status: "PAGATO_DAL_FORNITORE" }),
          ...(dates.adjusted
            ? {
                insertionDate: dates.insertionDate,
                supplyStartDate: dates.supplyStartDate,
              }
            : {}),
        },
      });
      // Allinea received al gettone attuale
      await prisma.commission.update({
        where: { id: commission.id },
        data: {
          received: Number(commission.expected ?? 0) || 0,
          accrued: Number(commission.expected ?? 0) || 0,
        },
      });
      await syncRecurringMonthsForContract(commission.contractId).catch(() => undefined);
    }
  } else if (field === "supplyStartDate") {
    const raw = value.trim();
    if (!raw) {
      await prisma.contract.update({
        where: { id: commission.contractId },
        data: { supplyStartDate: null },
      });
    } else {
      const d = parseFlexibleDate(raw);
      if (!d) throw new Error("Data non valida (usa GG/MM/AAAA)");
      const op = normalizeOperationType(commission.contract.operationType);
      const fixed = fixSwitchEqualInsertionSupply(
        commission.contract.insertionDate ?? d,
        d,
        op,
      );
      await prisma.contract.update({
        where: { id: commission.contractId },
        data: {
          supplyStartDate: fixed.supplyStartDate,
          insertionDate: fixed.insertionDate,
        },
      });
    }
    await syncRecurringMonthsForContract(commission.contractId).catch(() => undefined);
  } else if (field === "recurrence") {
    const { normalizeRecurrence } = await import("@/lib/recurring");
    const normalized = normalizeRecurrence(value);
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
      if (commission.contract.status === "STORNATO") {
        await prisma.contract.update({
          where: { id: commission.contractId },
          data: {
            status: commission.contract.collectionDate
              ? "PAGATO_DAL_FORNITORE"
              : "IN_ATTESA_PAGAMENTO",
            paymentStatus: commission.contract.collectionDate
              ? "Incassato"
              : "Da incassare",
          },
        });
      }
    } else {
      // Compensazione: gettone storno in negativo + stato Stornato
      const amount = Math.abs(
        effectiveGettone({
          expected: Number(commission.expected ?? 0),
          clientType: commission.contract.client.type,
          supplierName: commission.contract.supplier.name,
        }),
      );
      await prisma.commission.update({
        where: { id: commission.id },
        data: {
          stornoDate: commission.stornoDate ?? new Date(),
          stornoAmount: amount > 0 ? -amount : 0,
        },
      });
      await prisma.contract.update({
        where: { id: commission.contractId },
        data: {
          status: "STORNATO",
          paymentStatus: "Stornato",
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
      if (commission.contract.status === "STORNATO") {
        await prisma.contract.update({
          where: { id: commission.contractId },
          data: {
            status: commission.contract.collectionDate
              ? "PAGATO_DAL_FORNITORE"
              : "IN_ATTESA_PAGAMENTO",
            paymentStatus: commission.contract.collectionDate
              ? "Incassato"
              : "Da incassare",
          },
        });
      }
    } else {
      const d = parseFlexibleDate(raw);
      if (!d) throw new Error("Data storno non valida (usa MM/AAAA o GG/MM/AAAA)");
      const existing = Number(commission.stornoAmount ?? 0);
      const base = Math.abs(
        existing ||
          effectiveGettone({
            expected: Number(commission.expected ?? 0),
            clientType: commission.contract.client.type,
            supplierName: commission.contract.supplier.name,
          }),
      );
      await prisma.commission.update({
        where: { id: commission.id },
        data: { stornoDate: d, stornoAmount: base > 0 ? -base : 0 },
      });
      await prisma.contract.update({
        where: { id: commission.contractId },
        data: { status: "STORNATO", paymentStatus: "Stornato" },
      });
    }
  } else if (field === "stornoAmount") {
    const amount = Number(value.replace(",", ".")) || 0;
    // Accetta negativo; se positivo lo converte in compensazione (-)
    const signed = amount === 0 ? 0 : amount < 0 ? amount : -Math.abs(amount);
    await prisma.commission.update({
      where: { id: commission.id },
      data: {
        stornoAmount: signed === 0 ? null : signed,
        stornoDate:
          signed !== 0 ? (commission.stornoDate ?? new Date()) : null,
      },
    });
    if (signed !== 0) {
      await prisma.contract.update({
        where: { id: commission.contractId },
        data: { status: "STORNATO", paymentStatus: "Stornato" },
      });
    }
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
      const wasPaid = Boolean(commission.contract.collectionDate);
      await prisma.contract.update({
        where: { id: contractId },
        data: { status: "KO" },
      });
      if (!wasPaid) {
        // Mai incassato → gettone a 0, niente storno
        await prisma.commission.update({
          where: { id: commission.id },
          data: {
            expected: 0,
            received: 0,
            paid: 0,
            stornoDate: null,
            stornoAmount: null,
          },
        });
      }
      // Già incassato (es. Helios in fornitura): NON auto-storno.
      // Helios paga solo in fornitura: lo storno gettone si mette solo a mano
      // (colonna Storno Sì/No) o se altrove cambia il periodo di storno.
      await syncRecurringMonthsForContract(contractId).catch(() => undefined);
    } else if (/controll/.test(raw)) {
      // Inserito ma non ancora contrattualizzato: da visionare e aggiornare
      await prisma.contract.update({
        where: { id: contractId },
        data: {
          status: "DA_CONTROLLARE",
          paymentStatus: "Da controllare",
        },
      });
    } else if (/^storn/.test(raw)) {
      // Storno applicato e conteggiato in Report Incassato (importo negativo)
      const amount = Math.abs(
        Number(commission.stornoAmount ?? 0) ||
          effectiveGettone({
            expected: Number(commission.expected ?? 0),
            clientType: commission.contract.client.type,
            supplierName: commission.contract.supplier.name,
          }),
      );
      await prisma.commission.update({
        where: { id: commission.id },
        data: {
          stornoDate: commission.stornoDate ?? new Date(),
          stornoAmount: amount > 0 ? -amount : 0,
        },
      });
      await prisma.contract.update({
        where: { id: contractId },
        data: {
          status: "STORNATO",
          paymentStatus: "Stornato",
        },
      });
    } else if (/pagat/.test(raw)) {
      // Pagato collaboratore: liquidazione provvigione
      const received = Number(commission.received ?? 0) || 0;
      const paid = Number(commission.paid ?? 0) || 0;
      const remaining = Math.max(0, received - paid);

      if (remaining > 0) {
        await prisma.commission.update({
          where: { id: commission.id },
          data: { paid: paid + remaining },
        });
        await prisma.commissionEntry.create({
          data: {
            commissionId: commission.id,
            type: "paid",
            amount: remaining,
            paidById: session.id,
            note: "Liquidazione collaboratore",
          },
        });
      }

      const dates = fixFutureDatesForPayment({
        insertionDate: commission.contract.insertionDate,
        supplyStartDate: commission.contract.supplyStartDate,
        operationType: commission.contract.operationType,
      });
      await prisma.contract.update({
        where: { id: contractId },
        data: {
          status: "PROVVIGIONE_LIQUIDATA",
          paymentStatus: "Incassato",
          collectionDate: commission.contract.collectionDate ?? new Date(),
          ...(dates.adjusted
            ? {
                insertionDate: dates.insertionDate,
                supplyStartDate: dates.supplyStartDate,
              }
            : {}),
        },
      });
      await syncRecurringMonthsForContract(contractId).catch(() => undefined);
    } else if (/incass/.test(raw) && !/da\s*incass/.test(raw) && !/^no$/.test(raw)) {
      const dates = fixFutureDatesForPayment({
        insertionDate: commission.contract.insertionDate,
        supplyStartDate: commission.contract.supplyStartDate,
        operationType: commission.contract.operationType,
      });
      await prisma.contract.update({
        where: { id: contractId },
        data: {
          status: "PAGATO_DAL_FORNITORE",
          paymentStatus: "Incassato",
          collectionDate: commission.contract.collectionDate ?? new Date(),
          ...(dates.adjusted
            ? {
                insertionDate: dates.insertionDate,
                supplyStartDate: dates.supplyStartDate,
              }
            : {}),
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
        active: true,
        name: { equals: raw, mode: "insensitive" },
        role: { in: ["COLLABORATORE", "COMMERCIALE", "AREA_MANAGER", "ADMIN", "SEGRETERIA"] },
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
    const existing = await prisma.client.findUnique({
      where: { id: commission.contract.clientId },
    });
    if (!existing) throw new Error("Cliente non trovato");

    const isAzienda = existing.type === "AZIENDA";
    const parsed = isAzienda ? null : parsePrivatoDisplayName(raw);

    // Se lo stesso Client è su più contratti, rinominarlo cambierebbe TUTTE le righe.
    // In Provvigioni ogni riga = un contratto: creiamo un’anagrafica solo per questo.
    const otherCount = await prisma.contract.count({
      where: {
        clientId: existing.id,
        id: { not: commission.contractId },
        deletedAt: null,
      },
    });

    if (otherCount > 0) {
      const created = await prisma.client.create({
        data: {
          type: existing.type,
          companyName: isAzienda ? raw : existing.companyName,
          firstName: isAzienda ? existing.firstName : parsed!.firstName,
          lastName: isAzienda ? existing.lastName : parsed!.lastName,
          fiscalCode: existing.fiscalCode,
          vatNumber: existing.vatNumber,
          email: existing.email,
          pec: existing.pec,
          phone: existing.phone,
          iban: existing.iban,
          address: existing.address,
          street: existing.street,
          streetNumber: existing.streetNumber,
          city: existing.city,
          province: existing.province,
          region: existing.region,
          zipCode: existing.zipCode,
          country: existing.country,
          classification: existing.classification,
          legalFirstName: existing.legalFirstName,
          legalLastName: existing.legalLastName,
          legalFiscalCode: existing.legalFiscalCode,
          sdiCode: existing.sdiCode,
          supplyAddress: existing.supplyAddress,
          supplyStreet: existing.supplyStreet,
          supplyStreetNumber: existing.supplyStreetNumber,
          supplyCity: existing.supplyCity,
          supplyProvince: existing.supplyProvince,
          supplyRegion: existing.supplyRegion,
          supplyZipCode: existing.supplyZipCode,
          addressesMatch: existing.addressesMatch,
          notes: existing.notes,
          createdById: session.id,
        },
      });
      await prisma.contract.update({
        where: { id: commission.contractId },
        data: { clientId: created.id },
      });
    } else if (isAzienda) {
      await prisma.client.update({
        where: { id: existing.id },
        data: { companyName: raw },
      });
    } else {
      await prisma.client.update({
        where: { id: existing.id },
        data: {
          lastName: parsed!.lastName,
          firstName: parsed!.firstName,
        },
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

    // Ordine sicuro per riga: prima i campi «normali», poi stato, infine storno
    // (così un Storno Sì/No manuale non viene sovrascritto dallo stato).
    const FIELD_ORDER: Record<string, number> = {
      stato: 50,
      storno: 80,
      stornoDate: 90,
      stornoAmount: 100,
    };
    const ordered = [...changes].sort((a, b) => {
      const idCmp = String(a.commissionId).localeCompare(String(b.commissionId));
      if (idCmp !== 0) return idCmp;
      const oa = FIELD_ORDER[String(a.field)] ?? 10;
      const ob = FIELD_ORDER[String(b.field)] ?? 10;
      return oa - ob;
    });

    for (const ch of ordered) {
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
      expected: true,
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

/** Segna incassato (collectionDate) su più contratti. */
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
    const full = await prisma.contract.findUnique({
      where: { id: r.contractId },
      select: {
        insertionDate: true,
        supplyStartDate: true,
        operationType: true,
      },
    });
    const dates = full
      ? fixFutureDatesForPayment({
          insertionDate: full.insertionDate,
          supplyStartDate: full.supplyStartDate,
          operationType: full.operationType,
        })
      : null;
    await prisma.contract.update({
      where: { id: r.contractId },
      data: {
        paymentStatus: "Incassato",
        collectionDate,
        status: "PAGATO_DAL_FORNITORE",
        ...(dates?.adjusted
          ? {
              insertionDate: dates.insertionDate,
              supplyStartDate: dates.supplyStartDate,
            }
          : {}),
      },
    });
    await prisma.commission.update({
      where: { id: r.id },
      data: {
        received: Number(r.expected ?? 0) || 0,
        accrued: Number(r.expected ?? 0) || 0,
      },
    });
    await syncRecurringMonthsForContract(r.contractId).catch(() => undefined);
  }

  await writeAuditLog({
    userId: session.id,
    action: "UPDATE",
    entity: "Commission",
    entityId: rows[0]?.contractId ?? "",
    details: {
      source: "bulk_mark_incassato",
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
  const competenceRaw = String(formData.get("competencePeriod") ?? "").trim();
  const competencePeriod = /^\d{4}-\d{2}$/.test(competenceRaw)
    ? competenceRaw
    : null;
  const settledRaw = String(formData.get("settledPeriod") ?? "").trim();
  const settledPeriod = /^\d{4}-\d{2}$/.test(settledRaw)
    ? settledRaw
    : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

  let monthsPaid = 0;
  let contractsTouched = 0;

  for (const r of rows) {
    const missing = await prisma.recurringMonth.findMany({
      where: {
        contractId: r.contractId,
        status: { in: ["MISSING", "PENDING"] },
        ...(mode === "exact" && competencePeriod ? { period: competencePeriod } : {}),
      },
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

/** Liquida soltanto la rata ricorrente della competenza scelta. */
export async function bulkLiquidateRecurringPeriodAction(
  formData: FormData,
): Promise<{ ok: true; count: number }> {
  const session = await requireSession();
  const ids = parseIdList(formData, "commissionIds");
  const commissions = await assertCanAccessCommissions(session, ids);
  const period = String(formData.get("competencePeriod") ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error("Mese di competenza non valido");

  const installments = await prisma.recurringMonth.findMany({
    where: {
      contractId: { in: commissions.map((row) => row.contractId) },
      period,
      status: "PAID",
    },
    select: { id: true },
  });
  for (const installment of installments) {
    await prisma.recurringMonth.update({
      where: { id: installment.id },
      data: { status: "LIQUIDATED" },
    });
  }

  await writeAuditLog({
    userId: session.id,
    action: "UPDATE",
    entity: "RecurringMonth",
    entityId: period,
    details: { source: "bulk_liquidate_recurring_period", period, count: installments.length },
  });
  revalidatePath("/provvigioni");
  revalidatePath("/");
  return { ok: true, count: installments.length };
}

type CommissionByContract = {
  id: string;
  contractId: string;
  received: unknown;
  paid: unknown;
  contract: { collaboratorId: string; collectionDate: Date | null };
};

async function assertCanAccessCommissionsByContractIds(
  session: { id: string; role: Parameters<typeof hasPermission>[0] },
  contractIds: string[],
): Promise<CommissionByContract[]> {
  if (contractIds.length === 0) throw new Error("Nessuna riga selezionata");
  if (contractIds.length > 200)
    throw new Error("Massimo 200 righe per volta");

  const rows = await prisma.commission.findMany({
    where: { contractId: { in: contractIds } },
    select: {
      id: true,
      contractId: true,
      received: true,
      paid: true,
      contract: { select: { collaboratorId: true, collectionDate: true } },
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

/**
 * Liquida provvigioni collaboratori (stato = PROVVIGIONE_LIQUIDATA)
 * per le righe selezionate. Incrementa commission.paid di (received - paid).
 */
export async function bulkLiquidateSelectedAction(
  formData: FormData,
): Promise<{ ok: true; count: number }> {
  const session = await requireSession();
  const contractIds = parseIdList(formData, "contractIds");
  const rows = await assertCanAccessCommissionsByContractIds(session, contractIds);
  const monthRaw = String(formData.get("collectionMonth") ?? "").trim();
  const requestedCollectionDate = monthRaw ? parseFlexibleDate(monthRaw) : new Date();
  if (!requestedCollectionDate) throw new Error("Data non valida (usa MM/AAAA)");

  for (const r of rows) {
    const received = Number(r.received ?? 0) || 0;
    const paid = Number(r.paid ?? 0) || 0;
    const remaining = Math.max(0, received - paid);

    if (remaining > 0) {
      await prisma.commission.update({
        where: { id: r.id },
        data: { paid: paid + remaining },
      });
      await prisma.commissionEntry.create({
        data: {
          commissionId: r.id,
          type: "paid",
          amount: remaining,
          paidById: session.id,
          note: "Liquidazione collaboratore",
        },
      });
    }

    await prisma.contract.update({
      where: { id: r.contractId },
      data: {
        status: "PROVVIGIONE_LIQUIDATA",
        paymentStatus: "Incassato",
        collectionDate: requestedCollectionDate,
      },
    });
  }

  await writeAuditLog({
    userId: session.id,
    action: "UPDATE",
    entity: "Commission",
    entityId: rows[0]?.contractId ?? "",
    details: { source: "bulk_liquidate_selected", count: rows.length },
  });

  revalidatePath("/provvigioni");
  revalidatePath("/");
  revalidatePath("/contratti");
  return { ok: true, count: rows.length };
}

/**
 * Liquida TUTTI gli incassati (Incassato) ma non ancora pagati (non PROVVIGIONE_LIQUIDATA)
 * secondo i filtri correnti della pagina Provvigioni.
 */
export async function bulkLiquidateIncassatiAction(
  formData: FormData,
): Promise<{ ok: true; count: number }> {
  const session = await requireSession();
  if (!hasPermission(session.role, "commissions.view_all")) {
    throw new Error("Permesso negato");
  }

  const collab = String(formData.get("collab") ?? "").trim() || null;
  const supplier = String(formData.get("supplier") ?? "").trim() || null;
  const q = String(formData.get("q") ?? "").trim() || null;
  const tipologia = String(formData.get("tipologia") ?? "").trim() || null;
  const vista = String(formData.get("vista") ?? "").trim() || null;
  const recurrenceMode =
    vista === "mensile" || vista === "ricorrente"
      ? "monthly"
      : vista === "annuale"
        ? "annual"
        : "all";

  const visibility = await contractVisibilityWhere({ id: session.id, role: session.role });

  const baseWhere = buildProvvigioniContractWhere({
    canViewAll: true,
    sessionUserId: session.id,
    collab,
    supplier,
    stato: "Incassato",
    tipologia,
    q,
    recurrenceMode,
    visibility,
  });

  // Incassato ma NON ancora liquidato
  const where = {
    AND: [
      baseWhere,
      { status: { not: "PROVVIGIONE_LIQUIDATA" } },
      {
        status: {
          notIn: ["KO", "ANNULLATO", "CHIUSO", "PROVVIGIONE_LIQUIDATA"],
        },
      },
    ],
  };

  const limit = 5000;
  const rows = await prisma.commission.findMany({
    where: { contract: where as any },
    select: {
      id: true,
      contractId: true,
      received: true,
      paid: true,
      contract: { select: { collaboratorId: true } },
    },
    take: limit,
  });

  for (const r of rows) {
    const received = Number(r.received ?? 0) || 0;
    const paid = Number(r.paid ?? 0) || 0;
    const remaining = Math.max(0, received - paid);

    if (remaining > 0) {
      await prisma.commission.update({
        where: { id: r.id },
        data: { paid: paid + remaining },
      });
      await prisma.commissionEntry.create({
        data: {
          commissionId: r.id,
          type: "paid",
          amount: remaining,
          paidById: session.id,
          note: "Liquidazione collaboratore",
        },
      });
    }

    await prisma.contract.update({
      where: { id: r.contractId },
      data: { status: "PROVVIGIONE_LIQUIDATA" },
    });
  }

  await writeAuditLog({
    userId: session.id,
    action: "UPDATE",
    entity: "Commission",
    entityId: rows[0]?.contractId ?? "",
    details: { source: "bulk_liquidate_incassati", count: rows.length, limit },
  });

  revalidatePath("/provvigioni");
  revalidatePath("/");
  revalidatePath("/contratti");
  return { ok: true, count: rows.length };
}
