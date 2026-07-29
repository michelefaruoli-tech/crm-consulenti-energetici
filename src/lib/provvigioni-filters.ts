/**
 * Filtri condivisi Provvigioni (pagina + export Excel).
 * Solo contratti attivi (non storici, non eliminati).
 *
 * I filtri colonna (fornitore, stato, tipologia) sono server-side:
 * applicano a tutto il database, non solo alla pagina da 100 righe.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export type ProvvigioniFilters = {
  canViewAll: boolean;
  sessionUserId: string;
  /** ID collaboratore da query ?collab= */
  collab?: string | null;
  /** Nome fornitore esatto (es. Enel) da ?supplier= */
  supplier?: string | null;
  /** Stato semplificato: Incassato | Da incassare | Pagato | KO / Cessato */
  stato?: string | null;
  /** Tipologia: Business | Domestico */
  tipologia?: string | null;
  /** Cerca cliente (nome, cognome, ragione sociale, CF, POD) */
  q?: string | null;
  /**
   * Scheda:
   * - all = tutti (default)
   * - exclude = solo gettoni/una tantum (nasconde R)
   * - only = solo ricorrenti
   */
  recurrenceMode?: "exclude" | "only" | "all" | null;
  /** Scope backoffice / collaboratore (AND aggiuntivo) */
  visibility?: Prisma.ContractWhereInput | null;
};

/** Filtro Prisma: contratti ricorrenti (R in Provvigioni). */
export const recurringWhereOr: Prisma.ContractWhereInput[] = [
  { recurrence: { equals: "R", mode: "insensitive" } },
  { recurrence: { equals: "Ricorrente", mode: "insensitive" } },
  { recurrence: { contains: "ricor", mode: "insensitive" } },
  { recurrence: { contains: "mensil", mode: "insensitive" } },
];

const KO_STATUSES = ["KO", "ANNULLATO", "CHIUSO"] as const;

/**
 * Filtro Prisma per stato semplificato (stessa logica Report + Provvigioni).
 *
 * - Da incassare = contratto inserito, fornitore non ha ancora pagato a te
 * - Incassato = fornitore ha pagato a te, tu non hai ancora liquidato il collab.
 * - Pagato = tu hai già pagato il collaboratore (PROVVIGIONE_LIQUIDATA)
 * - KO / Cessato = pratica chiusa (anche se aveva già un incasso storico)
 */
export function provvigioneStatoWhere(
  stato: string | null | undefined,
): Prisma.ContractWhereInput | undefined {
  const s = stato?.trim();
  if (!s || s === "Tutti") return undefined;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (s === "Incassato") {
    return {
      collectionDate: { not: null },
      status: { notIn: ["PROVVIGIONE_LIQUIDATA", ...KO_STATUSES] },
      // Solo già in fornitura (altrimenti la data è attivazione, non incasso)
      supplyStartDate: { lte: today },
    };
  }
  if (s === "Da incassare") {
    return {
      status: { notIn: [...KO_STATUSES] },
      OR: [
        { collectionDate: null },
        // Incasso/Pagato prematuro: non ancora in fornitura
        { supplyStartDate: { gt: today } },
        { supplyStartDate: null },
      ],
    };
  }
  if (s === "Pagato") {
    return {
      status: { equals: "PROVVIGIONE_LIQUIDATA" },
      supplyStartDate: { lte: today },
    };
  }
  if (s === "KO / Cessato") {
    return {
      status: { in: [...KO_STATUSES] },
    };
  }
  return undefined;
}

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
  const recurrenceMode = f.recurrenceMode ?? "all";

  const and: Prisma.ContractWhereInput[] = [
    { deletedAt: null },
    { isHistorical: false },
  ];

  if (f.visibility && Object.keys(f.visibility).length > 0) {
    and.push(f.visibility);
  }

  if (supplierName) {
    and.push({
      supplier: { name: { equals: supplierName, mode: "insensitive" } },
    });
  }

  const statoWhere = provvigioneStatoWhere(stato);
  if (statoWhere) and.push(statoWhere);

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
    // Ricorrenza NULL/vuota = gettone/una tantum (SQL NOT su NULL escludeva migliaia di righe)
    and.push({
      OR: [
        { recurrence: null },
        { recurrence: { equals: "" } },
        { NOT: { OR: recurringWhereOr } },
      ],
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
 * Somma gettoni su TUTTO il filtro (non solo la pagina).
 * Usa aggregati SQL (veloce) invece di caricare tutte le righe in memoria.
 * «Da incassare» = senza data incasso E non KO/cessato (come il filtro Stato).
 */
export async function sumProvvigioniTotals(
  contractWhere: Prisma.ContractWhereInput,
): Promise<ProvvigioniTotals> {
  const withCollection: Prisma.ContractWhereInput = {
    AND: [contractWhere, { collectionDate: { not: null } }],
  };
  // Allineato al filtro «Da incassare»: esclude KO / Annullato / Chiuso
  const withoutCollection: Prisma.ContractWhereInput = {
    AND: [
      contractWhere,
      { collectionDate: null },
      { status: { notIn: [...KO_STATUSES] } },
    ],
  };
  const recurringOnly: Prisma.ContractWhereInput = {
    AND: [contractWhere, { OR: recurringWhereOr }],
  };

  const [complessivoAgg, incassatoAgg, daIncassareAgg, ricorrentiAgg] =
    await Promise.all([
      prisma.commission.aggregate({
        where: { contract: contractWhere },
        _sum: { expected: true },
      }),
      prisma.commission.aggregate({
        where: { contract: withCollection },
        _sum: { expected: true },
      }),
      prisma.commission.aggregate({
        where: { contract: withoutCollection },
        _sum: { expected: true },
      }),
      prisma.commission.aggregate({
        where: { contract: recurringOnly },
        _sum: { expected: true },
      }),
    ]);

  return {
    complessivo: Number(complessivoAgg._sum.expected ?? 0),
    incassato: Number(incassatoAgg._sum.expected ?? 0),
    daIncassare: Number(daIncassareAgg._sum.expected ?? 0),
    ricorrenti: Number(ricorrentiAgg._sum.expected ?? 0),
  };
}
