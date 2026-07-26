/**
 * Filtri condivisi Provvigioni (pagina + export Excel).
 * Include anche i contratti da archivio storico (isHistorical),
 * così i database importati compaiono filtrando per collaboratore.
 *
 * I filtri colonna (fornitore, stato, tipologia) sono server-side:
 * applicano a tutto il database, non solo alla pagina da 100 righe.
 */
import type { Prisma } from "@/generated/prisma/client";
import { effectiveGettone, isRecurringMonthly } from "@/lib/provvigioni-stato";
import { prisma } from "@/lib/prisma";

export type ProvvigioniFilters = {
  canViewAll: boolean;
  sessionUserId: string;
  /** ID collaboratore da query ?collab= */
  collab?: string | null;
  /** Nome fornitore esatto (es. Enel) da ?supplier= */
  supplier?: string | null;
  /** Stato semplificato: Incassato | Da incassare | KO / Cessato */
  stato?: string | null;
  /** Tipologia: Business | Domestico */
  tipologia?: string | null;
  /** Cerca cliente (nome, cognome, ragione sociale, CF, POD) */
  q?: string | null;
  /**
   * Scheda:
   * - exclude = gettoni/una tantum (nasconde R) — default per snellire
   * - only = solo ricorrenti
   * - all = tutti
   */
  recurrenceMode?: "exclude" | "only" | "all" | null;
};

/** Filtro Prisma: contratti ricorrenti (R in Provvigioni). */
export const recurringWhereOr: Prisma.ContractWhereInput[] = [
  { recurrence: { equals: "R", mode: "insensitive" } },
  { recurrence: { contains: "Ricor", mode: "insensitive" } },
  { recurrence: { contains: "mensil", mode: "insensitive" } },
];

const KO_STATUSES = ["KO", "ANNULLATO", "CHIUSO"] as const;

export function buildProvvigioniContractWhere(
  f: ProvvigioniFilters,
): Prisma.ContractWhereInput {
  const collabFilter =
    f.canViewAll && f.collab && f.collab !== "tutti" ? f.collab : undefined;
  const collaboratorId = f.canViewAll ? collabFilter : f.sessionUserId;

  const supplierName = f.supplier?.trim() || undefined;
  const stato = f.stato?.trim() || undefined;
  const tipologia = f.tipologia?.trim() || undefined;
  const q = f.q?.trim() || undefined;
  const recurrenceMode = f.recurrenceMode ?? "exclude";

  const and: Prisma.ContractWhereInput[] = [];

  if (supplierName) {
    and.push({
      supplier: { name: { equals: supplierName, mode: "insensitive" } },
    });
  }

  if (stato === "Incassato") {
    and.push({ collectionDate: { not: null } });
  } else if (stato === "Da incassare") {
    and.push({
      collectionDate: null,
      status: { notIn: [...KO_STATUSES] },
    });
  } else if (stato === "KO / Cessato") {
    and.push({
      collectionDate: null,
      status: { in: [...KO_STATUSES] },
    });
  }

  if (tipologia === "Business") {
    and.push({ client: { type: "AZIENDA" } });
  } else if (tipologia === "Domestico") {
    and.push({ client: { type: "PRIVATO" } });
  }

  if (q) {
    and.push({
      OR: [
        { client: { firstName: { contains: q, mode: "insensitive" } } },
        { client: { lastName: { contains: q, mode: "insensitive" } } },
        { client: { companyName: { contains: q, mode: "insensitive" } } },
        { client: { fiscalCode: { contains: q, mode: "insensitive" } } },
        { client: { vatNumber: { contains: q, mode: "insensitive" } } },
        { podPdr: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  if (recurrenceMode === "only") {
    and.push({ OR: recurringWhereOr });
  } else if (recurrenceMode === "exclude") {
    and.push({
      NOT: { OR: recurringWhereOr },
    });
  }

  return {
    deletedAt: null,
    ...(collaboratorId ? { collaboratorId } : {}),
    ...(and.length ? { AND: and } : {}),
  };
}

export type ProvvigioniTotals = {
  complessivo: number;
  daIncassare: number;
  ricorrenti: number;
  incassato: number;
};

/**
 * Somma gettoni su TUTTO il filtro (non solo la pagina),
 * usando gli stessi default privati della tabella (Enel 65, …).
 * Così i totali coincidono con la somma dei gettoni che vedi nelle righe.
 */
export async function sumProvvigioniTotals(
  contractWhere: Prisma.ContractWhereInput,
): Promise<ProvvigioniTotals> {
  const rows = await prisma.contract.findMany({
    where: contractWhere,
    select: {
      collectionDate: true,
      recurrence: true,
      client: { select: { type: true } },
      supplier: { select: { name: true } },
      commission: { select: { expected: true } },
    },
  });

  let complessivo = 0;
  let incassato = 0;
  let daIncassare = 0;
  let ricorrenti = 0;

  for (const row of rows) {
    const amount = effectiveGettone({
      expected: Number(row.commission?.expected ?? 0),
      clientType: row.client.type,
      supplierName: row.supplier.name,
    });
    complessivo += amount;
    if (row.collectionDate) incassato += amount;
    else daIncassare += amount;
    if (isRecurringMonthly(row.recurrence)) ricorrenti += amount;
  }

  return { complessivo, daIncassare, ricorrenti, incassato };
}
