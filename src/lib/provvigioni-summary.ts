/**
 * Totali finanziari Provvigioni: incassato, da incassare, pagato.
 *
 * - Incassato: fornitore ha pagato, collaboratore non ancora liquidato (PAID / collectionDate senza liquidazione)
 * - Da incassare: in attesa pagamento fornitore (MISSING/PENDING o senza collectionDate)
 * - Pagato: liquidato al collaboratore (LIQUIDATED / PROVVIGIONE_LIQUIDATA)
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  recurringAnnualWhereOr,
  recurringMonthlyWhereOr,
  recurringWhereOr,
} from "@/lib/provvigioni-filters";

export type ProvvigioniFinancialSummary = {
  incassatoCount: number;
  incassatoAmount: number;
  daIncassareCount: number;
  daIncassareAmount: number;
  pagatoCount: number;
  pagatoAmount: number;
};

const MISSING = ["MISSING", "PENDING", "ERROR_UNPAID"] as const;

function sumAmounts(rows: Array<{ amount: { toString(): string } | null }>): number {
  return rows.reduce((s, r) => s + Number(r.amount?.toString() ?? 0), 0);
}

function emptySummary(): ProvvigioniFinancialSummary {
  return {
    incassatoCount: 0,
    incassatoAmount: 0,
    daIncassareCount: 0,
    daIncassareAmount: 0,
    pagatoCount: 0,
    pagatoAmount: 0,
  };
}

/** Rate ricorrenti (M/R) nel periodo indicato, o tutte se period null. */
async function sumRecurringByStatus(
  contractWhere: Prisma.ContractWhereInput,
  period: string | null,
): Promise<ProvvigioniFinancialSummary> {
  const rows = await prisma.recurringMonth.findMany({
    where: {
      ...(period ? { period } : {}),
      status: { not: "CLOSED" },
      contract: contractWhere,
    },
    select: { status: true, amount: true, contractId: true },
  });

  const paid = rows.filter((r) => r.status === "PAID");
  const missing = rows.filter((r) =>
    (MISSING as readonly string[]).includes(r.status),
  );
  const liquidated = rows.filter((r) => r.status === "LIQUIDATED");

  return {
    incassatoCount: new Set(paid.map((r) => r.contractId)).size,
    incassatoAmount: sumAmounts(paid),
    daIncassareCount: new Set(missing.map((r) => r.contractId)).size,
    daIncassareAmount: sumAmounts(missing),
    pagatoCount: new Set(liquidated.map((r) => r.contractId)).size,
    pagatoAmount: sumAmounts(liquidated),
  };
}

/** Gettoni UT: logica a livello contratto (no RecurringMonth). */
async function sumUtByStatus(
  contractWhere: Prisma.ContractWhereInput,
): Promise<ProvvigioniFinancialSummary> {
  const utWhere: Prisma.ContractWhereInput = {
    AND: [
      contractWhere,
      {
        OR: [
          { recurrence: null },
          { recurrence: { equals: "" } },
          { NOT: { OR: recurringWhereOr } },
        ],
      },
    ],
  };

  const contracts = await prisma.contract.findMany({
    where: utWhere,
    select: {
      id: true,
      status: true,
      collectionDate: true,
      commission: { select: { expected: true } },
    },
  });

  let incassatoCount = 0;
  let incassatoAmount = 0;
  let daIncassareCount = 0;
  let daIncassareAmount = 0;
  let pagatoCount = 0;
  let pagatoAmount = 0;

  for (const c of contracts) {
    const amt = Number(c.commission?.expected ?? 0) || 0;
    if (c.status === "PROVVIGIONE_LIQUIDATA") {
      pagatoCount += 1;
      pagatoAmount += amt;
    } else if (c.collectionDate) {
      incassatoCount += 1;
      incassatoAmount += amt;
    } else if (!["KO", "ANNULLATO", "CHIUSO", "STORNATO", "DA_CONTROLLARE"].includes(c.status)) {
      daIncassareCount += 1;
      daIncassareAmount += amt;
    }
  }

  return {
    incassatoCount,
    incassatoAmount,
    daIncassareCount,
    daIncassareAmount,
    pagatoCount,
    pagatoAmount,
  };
}

function mergeSummaries(
  ...parts: ProvvigioniFinancialSummary[]
): ProvvigioniFinancialSummary {
  return parts.reduce(
    (acc, p) => ({
      incassatoCount: acc.incassatoCount + p.incassatoCount,
      incassatoAmount: acc.incassatoAmount + p.incassatoAmount,
      daIncassareCount: acc.daIncassareCount + p.daIncassareCount,
      daIncassareAmount: acc.daIncassareAmount + p.daIncassareAmount,
      pagatoCount: acc.pagatoCount + p.pagatoCount,
      pagatoAmount: acc.pagatoAmount + p.pagatoAmount,
    }),
    emptySummary(),
  );
}

export type SummaryVista = "tutti" | "mensile" | "annuale";

/**
 * Totali per i filtri attivi (senza filtro stato).
 * @param competencePeriod YYYY-MM oppure null = tutti i mesi (solo ricorrenti)
 */
export async function loadProvvigioniFinancialSummary(
  contractWhere: Prisma.ContractWhereInput,
  vista: SummaryVista,
  competencePeriod: string | null,
): Promise<ProvvigioniFinancialSummary> {
  if (vista === "mensile") {
    return sumRecurringByStatus(
      {
        AND: [contractWhere, { OR: recurringMonthlyWhereOr }],
      },
      competencePeriod,
    );
  }
  if (vista === "annuale") {
    return sumRecurringByStatus(
      {
        AND: [contractWhere, { OR: recurringAnnualWhereOr }],
      },
      competencePeriod,
    );
  }

  const recurring = await sumRecurringByStatus(
    {
      AND: [contractWhere, { OR: recurringWhereOr }],
    },
    competencePeriod,
  );
  const ut = competencePeriod ? emptySummary() : await sumUtByStatus(contractWhere);
  return mergeSummaries(recurring, ut);
}
