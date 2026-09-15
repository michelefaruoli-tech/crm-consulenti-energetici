import "server-only";

/**
 * Scrittura degli esiti dell'import sui contratti, e suo annullamento.
 *
 * Riusa la semantica già in uso nel CRM, senza reinventarla:
 * «incassato» = il fornitore ha pagato l'agenzia (`bulkMarkIncassatoCompetenceAction`),
 * «liquidato» = l'agenzia ha pagato il collaboratore (`bulkMarkPagatoCompetenceAction`).
 *
 * Ogni scrittura è preceduta dalla cattura dello stato precedente, così
 * l'applicazione è annullabile senza script correttivi. Non esistono
 * transazioni (adapter Neon HTTP): ogni riga è autoconclusiva e ripetibile.
 */

import { prisma } from "@/lib/prisma";
import { canMarkIncassatoForCompetencePeriod } from "@/lib/helios-provvigioni-shared";
import { isRecurringMonthly } from "@/lib/recurring";
import { computeSupplyStartDate } from "@/lib/supply-dates";
import { syncRecurringMonthsForContract } from "@/lib/recurring-sync";

export type PayoutMarkMode = "INCASSATO" | "LIQUIDATO";

/** Stato precedente, serializzato su `PayoutRow.previousStateJson`. */
export type PayoutPreviousState = {
  contract: {
    status: string;
    paymentStatus: string | null;
    collectionDate: string | null;
  };
  recurringMonth:
    | {
        existed: boolean;
        id: string | null;
        status: string | null;
        paidAt: string | null;
        settledPeriod: string | null;
        amount: number | null;
        note: string | null;
      }
    | null;
  commission: {
    id: string;
    received: number;
    accrued: number;
    paid: number;
    stornoDate: string | null;
    stornoAmount: number | null;
  } | null;
  /** Voce di liquidazione creata da questa riga, da rimuovere in annullamento */
  commissionEntryId?: string;
};

export type PayoutApplyOutcome =
  | {
      ok: true;
      recurringMonthId: string | null;
      previousState: PayoutPreviousState;
    }
  | { ok: false; reason: string };

function periodToDate(period: string): Date {
  const [y, m] = period.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, 1);
}

function isoOrNull(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

function numberOrZero(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Segna una riga sul contratto. Idempotente: se lo stato di arrivo è già
 * presente, non riscrive e segnala il motivo.
 */
export async function applyPayoutRowMark(params: {
  contractId: string;
  /** Mese di competenza YYYY-MM */
  period: string;
  /** Mese di rendiconto YYYY-MM */
  settledPeriod: string;
  amount: number | null;
  markMode: PayoutMarkMode;
  note: string;
}): Promise<PayoutApplyOutcome> {
  const contract = await prisma.contract.findUnique({
    where: { id: params.contractId },
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      collectionDate: true,
      recurrence: true,
      supplyStartDate: true,
      insertionDate: true,
      operationType: true,
      commission: {
        select: {
          id: true,
          expected: true,
          received: true,
          accrued: true,
          paid: true,
          stornoDate: true,
          stornoAmount: true,
        },
      },
    },
  });
  if (!contract) return { ok: false, reason: "Contratto non trovato" };

  const previousState: PayoutPreviousState = {
    contract: {
      status: contract.status,
      paymentStatus: contract.paymentStatus,
      collectionDate: isoOrNull(contract.collectionDate),
    },
    recurringMonth: null,
    commission: contract.commission
      ? {
          id: contract.commission.id,
          received: numberOrZero(contract.commission.received),
          accrued: numberOrZero(contract.commission.accrued),
          paid: numberOrZero(contract.commission.paid),
          stornoDate: isoOrNull(contract.commission.stornoDate),
          stornoAmount:
            contract.commission.stornoAmount == null
              ? null
              : numberOrZero(contract.commission.stornoAmount),
        }
      : null,
  };

  const recurring = isRecurringMonthly(contract.recurrence);
  const collectionDate = periodToDate(params.period);
  const expected = numberOrZero(contract.commission?.expected);
  const amount = params.amount ?? expected;

  /*
   * Riga di importo negativo: è uno storno del fornitore, non un incasso.
   * Va scritta con la semantica di clawback già in uso (`applyCommissionField`),
   * senza sovrascrivere l'incassato con un numero negativo.
   */
  if (amount < 0) {
    if (contract.status === "STORNATO") {
      return { ok: false, reason: "Contratto già stornato" };
    }
    if (contract.commission) {
      await prisma.commission.update({
        where: { id: contract.commission.id },
        data: {
          stornoDate: contract.commission.stornoDate ?? new Date(),
          stornoAmount: -Math.abs(amount),
        },
      });
    }
    await prisma.contract.update({
      where: { id: contract.id },
      data: { status: "STORNATO", paymentStatus: "Stornato" },
    });
    return { ok: true, recurringMonthId: null, previousState };
  }

  if (recurring) {
    // Il fornitore non può aver pagato un mese precedente all'ingresso in fornitura
    const supplyStart =
      contract.supplyStartDate ??
      computeSupplyStartDate(contract.insertionDate, contract.operationType);
    if (!canMarkIncassatoForCompetencePeriod(supplyStart, params.period)) {
      return {
        ok: false,
        reason: `Competenza ${params.period} precedente all'ingresso in fornitura`,
      };
    }

    const existing = await prisma.recurringMonth.findUnique({
      where: {
        contractId_period: {
          contractId: contract.id,
          period: params.period,
        },
      },
    });

    const targetStatus = params.markMode === "LIQUIDATO" ? "LIQUIDATED" : "PAID";
    if (existing?.status === targetStatus) {
      return { ok: false, reason: "Rata già nello stato richiesto" };
    }
    // Una rata già liquidata non torna a «solo incassata»
    if (existing?.status === "LIQUIDATED" && params.markMode === "INCASSATO") {
      return { ok: false, reason: "Rata già liquidata al collaboratore" };
    }

    previousState.recurringMonth = existing
      ? {
          existed: true,
          id: existing.id,
          status: existing.status,
          paidAt: isoOrNull(existing.paidAt),
          settledPeriod: existing.settledPeriod,
          amount: existing.amount == null ? null : numberOrZero(existing.amount),
          note: existing.note,
        }
      : { existed: false, id: null, status: null, paidAt: null, settledPeriod: null, amount: null, note: null };

    let monthId: string;
    if (existing) {
      const updated = await prisma.recurringMonth.update({
        where: { id: existing.id },
        data: {
          status: targetStatus,
          paidAt: existing.paidAt ?? new Date(),
          settledPeriod: params.settledPeriod,
          amount: params.amount ?? existing.amount,
          note: existing.note ?? params.note,
        },
        select: { id: true },
      });
      monthId = updated.id;
    } else {
      const created = await prisma.recurringMonth.create({
        data: {
          contractId: contract.id,
          period: params.period,
          status: targetStatus,
          paidAt: new Date(),
          settledPeriod: params.settledPeriod,
          amount: amount || null,
          note: params.note,
        },
        select: { id: true },
      });
      monthId = created.id;
    }

    if (params.markMode === "LIQUIDATO") {
      if (contract.commission) {
        const paid = numberOrZero(contract.commission.paid) + amount;
        await prisma.commission.update({
          where: { id: contract.commission.id },
          data: {
            paid,
            received: Math.max(numberOrZero(contract.commission.received), paid),
          },
        });
      }
      await prisma.contract.update({
        where: { id: contract.id },
        data: {
          status: "PROVVIGIONE_LIQUIDATA",
          paymentStatus: "Pagato",
          collectionDate,
        },
      });
    } else {
      await prisma.contract.update({
        where: { id: contract.id },
        data: {
          paymentStatus: "Incassato",
          collectionDate,
          ...(contract.status === "PROVVIGIONE_LIQUIDATA"
            ? {}
            : { status: "PAGATO_DAL_FORNITORE" }),
        },
      });
    }

    await syncRecurringMonthsForContract(contract.id).catch(() => undefined);
    return { ok: true, recurringMonthId: monthId, previousState };
  }

  // Gettone una tantum
  if (params.markMode === "LIQUIDATO") {
    if (contract.status === "PROVVIGIONE_LIQUIDATA") {
      return { ok: false, reason: "Provvigione già liquidata" };
    }
    let commissionEntryId: string | undefined;
    if (contract.commission) {
      const received = numberOrZero(contract.commission.received) || amount;
      const paid = numberOrZero(contract.commission.paid);
      const remaining = Math.max(0, received - paid);
      if (remaining > 0) {
        await prisma.commission.update({
          where: { id: contract.commission.id },
          data: { paid: paid + remaining },
        });
        const entry = await prisma.commissionEntry.create({
          data: {
            commissionId: contract.commission.id,
            type: "paid",
            amount: remaining,
            note: params.note,
          },
          select: { id: true },
        });
        commissionEntryId = entry.id;
      }
    }
    await prisma.contract.update({
      where: { id: contract.id },
      data: {
        status: "PROVVIGIONE_LIQUIDATA",
        paymentStatus: "Incassato",
        collectionDate,
      },
    });
    return {
      ok: true,
      recurringMonthId: null,
      previousState: { ...previousState, commissionEntryId },
    };
  }

  if (
    contract.paymentStatus === "Incassato" &&
    (contract.status === "PAGATO_DAL_FORNITORE" ||
      contract.status === "PROVVIGIONE_LIQUIDATA")
  ) {
    return { ok: false, reason: "Contratto già incassato" };
  }

  await prisma.contract.update({
    where: { id: contract.id },
    data: {
      paymentStatus: "Incassato",
      collectionDate,
      ...(contract.status === "PROVVIGIONE_LIQUIDATA"
        ? {}
        : { status: "PAGATO_DAL_FORNITORE" }),
    },
  });
  if (contract.commission) {
    await prisma.commission.update({
      where: { id: contract.commission.id },
      data: { received: amount, accrued: amount },
    });
  }
  return { ok: true, recurringMonthId: null, previousState };
}

/** Riporta il contratto allo stato precedente all'applicazione della riga. */
export async function revertPayoutRowMark(params: {
  contractId: string;
  recurringMonthId: string | null;
  previousState: PayoutPreviousState;
}): Promise<void> {
  const prev = params.previousState;

  if (prev.recurringMonth) {
    if (prev.recurringMonth.existed && prev.recurringMonth.id) {
      await prisma.recurringMonth.update({
        where: { id: prev.recurringMonth.id },
        data: {
          status: prev.recurringMonth.status ?? "PENDING",
          paidAt: prev.recurringMonth.paidAt
            ? new Date(prev.recurringMonth.paidAt)
            : null,
          settledPeriod: prev.recurringMonth.settledPeriod,
          amount: prev.recurringMonth.amount,
          note: prev.recurringMonth.note,
        },
      });
    } else if (params.recurringMonthId) {
      await prisma.recurringMonth
        .delete({ where: { id: params.recurringMonthId } })
        .catch(() => undefined);
    }
  }

  if (prev.commissionEntryId) {
    await prisma.commissionEntry
      .delete({ where: { id: prev.commissionEntryId } })
      .catch(() => undefined);
  }

  if (prev.commission) {
    await prisma.commission.update({
      where: { id: prev.commission.id },
      data: {
        received: prev.commission.received,
        accrued: prev.commission.accrued,
        paid: prev.commission.paid,
        stornoDate: prev.commission.stornoDate
          ? new Date(prev.commission.stornoDate)
          : null,
        stornoAmount: prev.commission.stornoAmount,
      },
    });
  }

  await prisma.contract.update({
    where: { id: params.contractId },
    data: {
      status: prev.contract.status as never,
      paymentStatus: prev.contract.paymentStatus,
      collectionDate: prev.contract.collectionDate
        ? new Date(prev.contract.collectionDate)
        : null,
    },
  });

  await syncRecurringMonthsForContract(params.contractId).catch(() => undefined);
}

/** Legge lo stato precedente salvato, tollerando dati non validi. */
export function parsePreviousState(
  json: string | null,
): PayoutPreviousState | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (
      parsed != null &&
      typeof parsed === "object" &&
      "contract" in parsed
    ) {
      return parsed as PayoutPreviousState;
    }
  } catch {
    return null;
  }
  return null;
}
