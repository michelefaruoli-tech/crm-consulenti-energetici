/**
 * Filtri condivisi Provvigioni (pagina + export Excel).
 * Solo contratti attivi (non storici, non eliminati).
 *
 * I filtri colonna (fornitore, stato, tipologia) sono server-side:
 * applicano a tutto il database, non solo alla pagina da 100 righe.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { contractTextSearchWhere } from "@/lib/list-search";
import { toPeriod } from "@/lib/recurring";

export type ProvvigioniFilters = {
  canViewAll: boolean;
  sessionUserId: string;
  /** ID collaboratore (uno o più, separati da |) da query ?collab= */
  collab?: string | null;
  /** Nome fornitore (uno o più, separati da |) da ?supplier= */
  supplier?: string | null;
  /** Stato semplificato: uno o più (es. "Da incassare|Incassato") */
  stato?: string | null;
  /** Tipologia: Business | Domestico (anche multi con |) */
  tipologia?: string | null;
  /** Cerca cliente (nome, cognome, ragione sociale, CF, POD) */
  q?: string | null;
/**
   * Scheda:
   * - all = tutti (default)
   * - exclude = solo gettoni/una tantum
   * - only = solo ricorrenti (M+R)
   * - monthly = solo ricorrenti mensili (M)
   * - annual = solo ricorrenti annuali (R)
   */
  recurrenceMode?: "exclude" | "only" | "all" | "monthly" | "annual" | null;
  /** Scope backoffice / collaboratore (AND aggiuntivo) */
  visibility?: Prisma.ContractWhereInput | null;
  /** Mese competenza YYYY-MM — allinea filtro Incassato/Pagato alle rate mensili */
  competencePeriod?: string | null;
};

/** Qualsiasi ricorrenza (mensile M o annuale R + legacy). */
export const recurringWhereOr: Prisma.ContractWhereInput[] = [
  { recurrence: { equals: "M", mode: "insensitive" } },
  { recurrence: { equals: "R", mode: "insensitive" } },
  { recurrence: { equals: "Ricorrente", mode: "insensitive" } },
  { recurrence: { contains: "ricor", mode: "insensitive" } },
  { recurrence: { contains: "mensil", mode: "insensitive" } },
  { recurrence: { contains: "annu", mode: "insensitive" } },
];

/** Solo ricorrenti mensili (M + legacy Ricorrente). */
export const recurringMonthlyWhereOr: Prisma.ContractWhereInput[] = [
  { recurrence: { equals: "M", mode: "insensitive" } },
  { recurrence: { equals: "Ricorrente", mode: "insensitive" } },
  { recurrence: { contains: "mensil", mode: "insensitive" } },
  {
    AND: [
      { recurrence: { contains: "ricor", mode: "insensitive" } },
      { NOT: { recurrence: { contains: "annu", mode: "insensitive" } } },
      { NOT: { recurrence: { equals: "R", mode: "insensitive" } } },
    ],
  },
];

/** Solo ricorrenti annuali (R / 12 mesi). */
export const recurringAnnualWhereOr: Prisma.ContractWhereInput[] = [
  { recurrence: { equals: "R", mode: "insensitive" } },
  { recurrence: { contains: "annu", mode: "insensitive" } },
  { recurrence: { contains: "12 mes", mode: "insensitive" } },
];

const KO_STATUSES = ["KO", "ANNULLATO", "CHIUSO"] as const;

/** Separatore URL per filtri multipli (es. Da+incassare|Incassato). */
export const FILTER_LIST_SEP = "|";
/** @deprecated usa FILTER_LIST_SEP */
export const STATO_FILTER_SEP = FILTER_LIST_SEP;

export function parseFilterList(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(FILTER_LIST_SEP)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function formatFilterList(values: string[]): string | null {
  const cleaned = values.map((s) => s.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  return cleaned.join(FILTER_LIST_SEP);
}

export function parseStatoFilter(raw: string | null | undefined): string[] {
  return parseFilterList(raw);
}

export function formatStatoFilter(values: string[]): string | null {
  return formatFilterList(values);
}

/**
 * Filtro Prisma per stato semplificato (stessa logica Report + Provvigioni).
 *
 * Accetta un solo stato oppure più stati uniti con `|` (OR).
 *
 * - Da controllare = inserito ma non ancora contrattualizzato (da visionare)
 * - Da incassare = contratto inserito, fornitore non ha ancora pagato a te
 * - Incassato = fornitore ha pagato a te, tu non hai ancora liquidato il collab.
 * - Pagato = tu hai già pagato il collaboratore (PROVVIGIONE_LIQUIDATA)
 * - Stornato = storno gettone applicato (clawback, importo negativo in Report)
 * - KO / Cessato = pratica chiusa (anche se aveva già un incasso storico)
 */
export type ProvvigioneStatoWhereOpts = {
  /** Mese competenza YYYY-MM per rate ricorrenti Helios */
  competencePeriod?: string | null;
};

export function provvigioneStatoWhere(
  stato: string | null | undefined,
  opts?: ProvvigioneStatoWhereOpts,
): Prisma.ContractWhereInput | undefined {
  const parts = parseStatoFilter(stato);
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return provvigioneStatoWhereOne(parts[0]!, opts);

  const ors = parts
    .map((p) => provvigioneStatoWhereOne(p, opts))
    .filter((w): w is Prisma.ContractWhereInput => Boolean(w));
  if (ors.length === 0) return undefined;
  if (ors.length === 1) return ors[0];
  return { OR: ors };
}

function provvigioneStatoWhereOne(
  stato: string,
  opts?: ProvvigioneStatoWhereOpts,
): Prisma.ContractWhereInput | undefined {
  const s = stato.trim();
  if (!s || s === "Tutti") return undefined;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (s === "Da controllare") {
    return { status: { equals: "DA_CONTROLLARE" } };
  }
  if (s === "Stornato") {
    return {
      OR: [
        { status: { equals: "STORNATO" } },
        { commission: { stornoDate: { not: null } } },
      ],
    };
  }
  if (s === "Incassato") {
    const competence = opts?.competencePeriod?.trim();
    const excludedStatus = [
      "PROVVIGIONE_LIQUIDATA",
      "DA_CONTROLLARE",
      "STORNATO",
      ...KO_STATUSES,
    ] as const;
    /** Solo PAID: LIQUIDATED = già pagato al collaboratore (scheda Pagato). */
    const recurringPaid: Prisma.RecurringMonthWhereInput = {
      status: "PAID",
      ...(competence ? { period: competence } : {}),
    };
    return {
      status: { notIn: [...excludedStatus] },
      OR: [
        {
          AND: [
            {
              OR: [
                { recurrence: null },
                { recurrence: { equals: "" } },
                { NOT: { OR: recurringWhereOr } },
              ],
            },
            { collectionDate: { not: null } },
            { supplyStartDate: { lte: today } },
          ],
        },
        {
          recurringMonths: { some: recurringPaid },
        },
      ],
    };
  }
  if (s === "Da incassare") {
    const competence = opts?.competencePeriod?.trim();
    const missingRate: Prisma.RecurringMonthWhereInput = {
      status: { in: ["MISSING", "PENDING", "ERROR_UNPAID"] },
      ...(competence ? { period: competence } : {}),
    };
    return {
      status: { notIn: ["DA_CONTROLLARE", "STORNATO", ...KO_STATUSES] },
      OR: [
        {
          AND: [
            {
              OR: [
                { recurrence: null },
                { recurrence: { equals: "" } },
                { NOT: { OR: recurringWhereOr } },
              ],
            },
            {
              OR: [
                { collectionDate: null },
                { supplyStartDate: { gt: today } },
                { supplyStartDate: null },
              ],
            },
          ],
        },
        {
          recurringMonths: { some: missingRate },
        },
      ],
    };
  }
  if (s === "Pagato") {
    const competence = opts?.competencePeriod?.trim();
    return {
      OR: [
        {
          status: { equals: "PROVVIGIONE_LIQUIDATA" },
          supplyStartDate: { lte: today },
        },
        {
          recurringMonths: {
            some: {
              status: "LIQUIDATED",
              ...(competence ? { period: competence } : {}),
            },
          },
        },
      ],
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
  const collabIds = parseFilterList(f.collab).filter((id) => id !== "tutti");
  let collaboratorFilter: string | { in: string[] } | undefined;
  if (!f.canViewAll) {
    collaboratorFilter = f.sessionUserId;
  } else if (collabIds.length === 1) {
    collaboratorFilter = collabIds[0];
  } else if (collabIds.length > 1) {
    collaboratorFilter = { in: collabIds };
  }

  const supplierNames = parseFilterList(f.supplier);
  const stato = f.stato?.trim() || undefined;
  const tipologie = parseFilterList(f.tipologia);
  const q = f.q?.trim() || undefined;
  const recurrenceMode = f.recurrenceMode ?? "all";

  const and: Prisma.ContractWhereInput[] = [
    { deletedAt: null },
    { isHistorical: false },
    { status: { notIn: [...KO_STATUSES] } },
  ];

  if (f.visibility && Object.keys(f.visibility).length > 0) {
    and.push(f.visibility);
  }

  if (supplierNames.length === 1) {
    and.push({
      supplier: { name: { equals: supplierNames[0], mode: "insensitive" } },
    });
  } else if (supplierNames.length > 1) {
    and.push({
      OR: supplierNames.map((name) => ({
        supplier: { name: { equals: name, mode: "insensitive" as const } },
      })),
    });
  }

  const statoWhere = provvigioneStatoWhere(stato, {
    competencePeriod: f.competencePeriod,
  });
  if (statoWhere) and.push(statoWhere);

  const clientTypes = tipologie
    .map((t) =>
      t === "Business" ? "AZIENDA" : t === "Domestico" ? "PRIVATO" : null,
    )
    .filter((t): t is "AZIENDA" | "PRIVATO" => Boolean(t));
  if (clientTypes.length === 1) {
    and.push({ client: { type: clientTypes[0] } });
  } else if (clientTypes.length > 1) {
    and.push({ client: { type: { in: clientTypes } } });
  }

  if (q) {
    const text = contractTextSearchWhere(q);
    if (text) and.push(text);
  }

  if (recurrenceMode === "only") {
    and.push({ OR: recurringWhereOr });
  } else if (recurrenceMode === "monthly") {
    and.push({ OR: recurringMonthlyWhereOr });
  } else if (recurrenceMode === "annual") {
    and.push({ OR: recurringAnnualWhereOr });
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
    ...(collaboratorFilter ? { collaboratorId: collaboratorFilter } : {}),
    ...(and.length ? { AND: and } : {}),
  };
}

export type ProvvigioniListFocus = "da-confermare" | "ricorrenze-mancanti";

export type ProvvigioniListWhereOpts = {
  filters: ProvvigioniFilters;
  focus?: ProvvigioniListFocus | null;
  /** Mese competenza attivo sulla lista (YYYY-MM) */
  effectiveCompetence?: string;
  applyCompetenceToList?: boolean;
};

/**
 * Where identico alla lista Provvigioni (pagina + export + card).
 * Include focus, stato, collaboratore e filtro mese competenza.
 */
export function buildProvvigioniListWhere(
  opts: ProvvigioniListWhereOpts,
): Prisma.ContractWhereInput {
  let where = buildProvvigioniContractWhere(opts.filters);

  if (opts.focus === "da-confermare") {
    where = { AND: [where, { commissionConfirmed: false }] };
  } else if (opts.focus === "ricorrenze-mancanti") {
    where = {
      AND: [
        where,
        {
          recurringMonths: {
            some: {
              status: { in: ["MISSING", "PENDING"] },
              period: { lt: toPeriod(new Date()) },
            },
          },
        },
      ],
    };
  }

  if (opts.applyCompetenceToList && opts.effectiveCompetence) {
    where = {
      AND: [
        where,
        provvigioniCompetenceWhere(
          opts.effectiveCompetence,
          opts.filters.stato,
        ),
      ],
    };
  }

  return where;
}

/** Filtro mese competenza: con Incassato/Pagato/Da incassare usa lo stato rata coerente. */
export function provvigioniCompetenceWhere(
  period: string,
  stato?: string | null,
): Prisma.ContractWhereInput {
  const stati = parseStatoFilter(stato);
  if (stati.length === 1 && stati[0] === "Incassato") {
    return {
      recurringMonths: {
        some: { period, status: "PAID" },
      },
    };
  }
  if (stati.length === 1 && stati[0] === "Pagato") {
    return { recurringMonths: { some: { period, status: "LIQUIDATED" } } };
  }
  if (stati.length === 1 && stati[0] === "Da incassare") {
    return {
      recurringMonths: {
        some: {
          period,
          status: { in: ["MISSING", "PENDING", "ERROR_UNPAID"] },
        },
      },
    };
  }
  return { recurringMonths: { some: { period, status: { not: "CLOSED" } } } };
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
