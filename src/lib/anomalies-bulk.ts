/**
 * Classificazione e bonifica delle segnalazioni «Anomalie» in Provvigioni
 * (rate mancanti + assenti da rendiconto Helios).
 *
 * Regole (Michele):
 * - competenza **prima** dell'inizio fornitura → elimina la riga
 * - competenza **in finestra** e ancora da incassare / ERROR_UNPAID → segna PAID
 * - resto → salta (già incassate, dopo chiusura, id spariti, …)
 *
 * Anteprima e Applica condividono `classifyAnomalyMonth`: il server
 * ri-verifica ogni id al momento dell'applicazione.
 */
import { prisma } from "@/lib/prisma";
import { periodLabel, toPeriod } from "@/lib/recurring";
import {
  isPeriodInRecurringWindow,
  outOfWindowReason,
  recurringWindow,
  type RecurringWindowContract,
} from "@/lib/recurring-window";

export type AnomalyBulkDecision =
  | "delete_before_start"
  | "mark_paid"
  | "skip";

export type AnomalyBulkPreviewRow = {
  monthId: string;
  contractId: string;
  period: string;
  periodLabel: string;
  status: string;
  clientLabel: string;
  decision: AnomalyBulkDecision;
  motivo: string;
};

export type AnomalyBulkPreview = {
  rows: AnomalyBulkPreviewRow[];
  deleteCount: number;
  markPaidCount: number;
  skipCount: number;
};

export type AnomalyBulkApplyRowResult = {
  monthId: string;
  period: string;
  outcome: "eliminata" | "incassata" | "saltata";
  motivo?: string;
};

const MARK_PAID_STATUSES = new Set(["MISSING", "PENDING", "ERROR_UNPAID"]);

const CONTRACT_SELECT = {
  id: true,
  insertionDate: true,
  supplyStartDate: true,
  operationType: true,
  status: true,
  expiryDate: true,
  podPdr: true,
  supplier: { select: { name: true } },
  client: {
    select: {
      type: true,
      companyName: true,
      firstName: true,
      lastName: true,
    },
  },
  statusHistory: {
    where: { toStatus: "CHIUSO" as const },
    select: { changedAt: true },
    orderBy: { changedAt: "desc" as const },
    take: 1,
  },
} as const;

type ContractRow = RecurringWindowContract & {
  id: string;
  podPdr: string | null;
  supplier: { name: string } | null;
  client: {
    type: string;
    companyName: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
};

function clientLabel(contract: ContractRow): string {
  const c = contract.client;
  const name =
    c?.type === "AZIENDA"
      ? (c.companyName ?? "—")
      : [c?.firstName, c?.lastName].filter(Boolean).join(" ") || "—";
  return `${name} · ${contract.supplier?.name ?? "—"}`;
}

/**
 * Classifica una rata rispetto alla finestra di fornitura del contratto.
 * Pura: nessun I/O.
 */
export function classifyAnomalyMonth(input: {
  period: string;
  status: string;
  window: { start: string; end: string | null };
}): { decision: AnomalyBulkDecision; motivo: string } {
  const { period, status, window } = input;

  if (period < window.start) {
    return {
      decision: "delete_before_start",
      motivo: outOfWindowReason(window, period) ?? "prima dell'inizio fornitura",
    };
  }

  if (!isPeriodInRecurringWindow(window, period)) {
    return {
      decision: "skip",
      motivo:
        outOfWindowReason(window, period) ??
        "fuori intervallo (non prima dell'inizio: revisione manuale)",
    };
  }

  if (status === "PAID" || status === "LIQUIDATED") {
    return { decision: "skip", motivo: "già incassata/liquidata" };
  }

  if (status === "CLOSED") {
    return { decision: "skip", motivo: "rata già chiusa" };
  }

  if (MARK_PAID_STATUSES.has(status)) {
    return {
      decision: "mark_paid",
      motivo: "in intervallo di fornitura — da segnare incassata",
    };
  }

  return { decision: "skip", motivo: `stato non gestito (${status})` };
}

/** Anteprima: classifica gli id passati (nessuna scrittura). */
export async function previewAnomaliesBulk(
  monthIds: string[],
  now: Date = new Date(),
): Promise<AnomalyBulkPreview> {
  const unique = [...new Set(monthIds.filter(Boolean))];
  if (unique.length === 0) {
    return { rows: [], deleteCount: 0, markPaidCount: 0, skipCount: 0 };
  }

  const months = await prisma.recurringMonth.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      contractId: true,
      period: true,
      status: true,
    },
  });
  const byId = new Map(months.map((m) => [m.id, m]));
  const contractIds = [...new Set(months.map((m) => m.contractId))];
  const contracts =
    contractIds.length > 0
      ? ((await prisma.contract.findMany({
          where: { id: { in: contractIds }, deletedAt: null },
          select: CONTRACT_SELECT,
        })) as ContractRow[])
      : [];
  const contractById = new Map(contracts.map((c) => [c.id, c]));

  const rows: AnomalyBulkPreviewRow[] = [];
  for (const monthId of unique) {
    const month = byId.get(monthId);
    if (!month) {
      rows.push({
        monthId,
        contractId: "",
        period: "—",
        periodLabel: "—",
        status: "—",
        clientLabel: "—",
        decision: "skip",
        motivo: "Rata non trovata",
      });
      continue;
    }
    const contract = contractById.get(month.contractId);
    if (!contract) {
      rows.push({
        monthId,
        contractId: month.contractId,
        period: month.period,
        periodLabel: periodLabel(month.period),
        status: month.status,
        clientLabel: "—",
        decision: "skip",
        motivo: "Contratto non trovato o eliminato",
      });
      continue;
    }
    const window = recurringWindow(contract, now);
    const { decision, motivo } = classifyAnomalyMonth({
      period: month.period,
      status: month.status,
      window,
    });
    rows.push({
      monthId,
      contractId: month.contractId,
      period: month.period,
      periodLabel: periodLabel(month.period),
      status: month.status,
      clientLabel: clientLabel(contract),
      decision,
      motivo,
    });
  }

  return {
    rows,
    deleteCount: rows.filter((r) => r.decision === "delete_before_start").length,
    markPaidCount: rows.filter((r) => r.decision === "mark_paid").length,
    skipCount: rows.filter((r) => r.decision === "skip").length,
  };
}

/**
 * Applica la classificazione: elimina prima dell'inizio, segna PAID le corrette.
 * Ri-verifica ogni id. Non tocca rate già PAID/LIQUIDATED né allineamenti
 * Helios fuori da questi id.
 */
export async function applyAnomaliesBulk(
  monthIds: string[],
  now: Date = new Date(),
): Promise<{
  deleted: number;
  markedPaid: number;
  skipped: number;
  rowResults: AnomalyBulkApplyRowResult[];
}> {
  const preview = await previewAnomaliesBulk(monthIds, now);
  const settledPeriod = toPeriod(now);
  const rowResults: AnomalyBulkApplyRowResult[] = [];
  let deleted = 0;
  let markedPaid = 0;
  let skipped = 0;
  const touchedContracts = new Set<string>();

  for (const row of preview.rows) {
    if (row.decision === "skip") {
      skipped += 1;
      rowResults.push({
        monthId: row.monthId,
        period: row.period,
        outcome: "saltata",
        motivo: row.motivo,
      });
      continue;
    }

    if (row.decision === "delete_before_start") {
      try {
        await prisma.recurringMonth.delete({ where: { id: row.monthId } });
        deleted += 1;
        if (row.contractId) touchedContracts.add(row.contractId);
        rowResults.push({
          monthId: row.monthId,
          period: row.period,
          outcome: "eliminata",
          motivo: row.motivo,
        });
      } catch {
        skipped += 1;
        rowResults.push({
          monthId: row.monthId,
          period: row.period,
          outcome: "saltata",
          motivo: "Eliminazione non riuscita (già rimossa?)",
        });
      }
      continue;
    }

    // mark_paid
    try {
      const existing = await prisma.recurringMonth.findUnique({
        where: { id: row.monthId },
        select: { id: true, status: true, paidAt: true, note: true, contractId: true },
      });
      if (!existing || !MARK_PAID_STATUSES.has(existing.status)) {
        skipped += 1;
        rowResults.push({
          monthId: row.monthId,
          period: row.period,
          outcome: "saltata",
          motivo: "Stato cambiato: riesegui l'anteprima",
        });
        continue;
      }

      const note =
        existing.note?.includes("ASSENTE_RENDICONTO")
          ? "Incassato da bonifica anomalie (era assente da rendiconto)"
          : existing.note;

      await prisma.recurringMonth.update({
        where: { id: row.monthId },
        data: {
          status: "PAID",
          paidAt: existing.paidAt ?? now,
          settledPeriod,
          note,
        },
      });

      const [y, m] = row.period.split("-").map(Number);
      await prisma.contract.update({
        where: { id: existing.contractId },
        data: {
          paymentStatus: "Incassato",
          collectionDate: new Date(y, m - 1, 1),
        },
      });

      markedPaid += 1;
      touchedContracts.add(existing.contractId);
      rowResults.push({
        monthId: row.monthId,
        period: row.period,
        outcome: "incassata",
        motivo: row.motivo,
      });
    } catch {
      skipped += 1;
      rowResults.push({
        monthId: row.monthId,
        period: row.period,
        outcome: "saltata",
        motivo: "Aggiornamento non riuscito",
      });
    }
  }

  // Sync leggero: non richiama syncRecurringMonthsForContract su ogni riga
  // (costoso). Le rate eliminate prima dell'inizio non devono essere ricreate
  // dal sync (finestra); le PAID restano. Eventuale sync globale resta nel Backup.
  void touchedContracts;

  return { deleted, markedPaid, skipped, rowResults };
}
