/**
 * Filtri di colonna Provvigioni applicati sul database (non sulle righe in pagina).
 *
 * Ogni colonna filtrabile ha un parametro URL dedicato e multi-valore (separatore `|`),
 * così una vista filtrata è condivisibile e ricaricabile. La traduzione in `where`
 * Prisma riproduce esattamente il valore mostrato in tabella, incluse le colonne
 * derivate (agenzia dal fornitore, gettone di listino per i domestici, etichetta
 * tipo operazione).
 *
 * Le righe della lista sono di due tipi (vedi `provvigioni-rows.ts`):
 * - riga unità: un contratto (UT, annuale, «in pagamento»);
 * - riga rata: un `RecurringMonth` di un contratto mensile.
 * Alcuni filtri valgono su entrambe (fornitore), altri solo su una delle due
 * (il mese di riferimento esiste solo sulle rate), perciò il builder restituisce
 * clausole separate per contratto, riga unità e rata.
 */
import type { Prisma } from "@/generated/prisma/client";
import { parseFilterList } from "@/lib/filter-list";
import {
  agencyFromSupplierName,
  defaultGettonePrivato,
  operationTypeLabel,
} from "@/lib/provvigioni-stato";

/** Valore mostrato nei menu per una cella vuota. */
export const EMPTY_FILTER_VALUE = "(vuoto)";

export type ProvvigioniColumnKey =
  | "clientName"
  | "podPdr"
  | "agency"
  | "operationType"
  | "recurrence"
  | "meseRif"
  | "supplyStartDate"
  | "collectionMonth"
  | "stornoFlag"
  | "stornoMonth"
  | "amount"
  | "stornoAmount"
  | "notes";

/** Colonna → parametro URL. Le altre (collab, forn., stato, tip.) usano i parametri storici. */
export const COLUMN_FILTER_PARAM: Record<ProvvigioniColumnKey, string> = {
  clientName: "cliente",
  podPdr: "pod",
  agency: "agenzia",
  operationType: "tipoop",
  recurrence: "tipo",
  meseRif: "mese",
  supplyStartDate: "forn",
  collectionMonth: "incasso",
  stornoFlag: "storno",
  stornoMonth: "mesestorno",
  amount: "gettone",
  stornoAmount: "gettonestorno",
  notes: "note",
};

export const COLUMN_FILTER_KEYS = Object.keys(
  COLUMN_FILTER_PARAM,
) as ProvvigioniColumnKey[];

/** Colonne a testo libero: il menu filtro è una casella «contiene». */
export const TEXT_FILTER_KEYS: ProvvigioniColumnKey[] = [
  "clientName",
  "podPdr",
  "notes",
];

/** Colonne il cui valore è un mese YYYY-MM (etichetta «mm/aaaa»). */
export const MONTH_FILTER_KEYS: ProvvigioniColumnKey[] = [
  "meseRif",
  "supplyStartDate",
  "collectionMonth",
  "stornoMonth",
];

export type ProvvigioniColumnFilters = Partial<
  Record<ProvvigioniColumnKey, string[]>
>;

type SearchParamsLike = Record<string, string | string[] | undefined>;

function readParam(sp: SearchParamsLike, name: string): string | undefined {
  const raw = sp[name];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

/** Legge tutti i filtri colonna dai parametri URL. */
export function parseProvvigioniColumnFilters(
  sp: SearchParamsLike,
): ProvvigioniColumnFilters {
  const out: ProvvigioniColumnFilters = {};
  for (const key of COLUMN_FILTER_KEYS) {
    const raw = readParam(sp, COLUMN_FILTER_PARAM[key]);
    if (TEXT_FILTER_KEYS.includes(key)) {
      const text = raw?.trim();
      if (text) out[key] = [text];
      continue;
    }
    const values = parseFilterList(raw);
    if (values.length > 0) out[key] = values;
  }
  return out;
}

export function hasColumnFilters(f: ProvvigioniColumnFilters): boolean {
  return COLUMN_FILTER_KEYS.some((k) => (f[k]?.length ?? 0) > 0);
}

/** Parametri URL da riportare in link/export per conservare i filtri attivi. */
export function columnFiltersToQuery(
  f: ProvvigioniColumnFilters,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of COLUMN_FILTER_KEYS) {
    const values = f[key];
    out[COLUMN_FILTER_PARAM[key]] = values?.length
      ? values.join("|")
      : undefined;
  }
  return out;
}

/**
 * Dati di contesto letti una volta per tradurre le colonne derivate.
 * Sono poche righe (fornitori e tipi operazione distinti): una query, niente N+1.
 */
export type ProvvigioniFilterContext = {
  suppliers: Array<{ id: string; name: string }>;
  operationTypes: Array<string | null>;
};

function monthRange(period: string): { gte: Date; lt: Date } | null {
  if (!/^\d{4}-\d{2}$/.test(period)) return null;
  const [y, m] = period.split("-").map(Number);
  return { gte: new Date(y!, m! - 1, 1), lt: new Date(y!, m!, 1) };
}

/** OR su più mesi per una colonna data (null = «(vuoto)»). */
function dateMonthsWhere(
  field: "supplyStartDate" | "collectionDate",
  values: string[],
): Prisma.ContractWhereInput | null {
  const ors: Prisma.ContractWhereInput[] = [];
  for (const value of values) {
    if (value === EMPTY_FILTER_VALUE) {
      ors.push({ [field]: null } as Prisma.ContractWhereInput);
      continue;
    }
    const range = monthRange(value);
    if (range) ors.push({ [field]: range } as Prisma.ContractWhereInput);
  }
  if (ors.length === 0) return null;
  return ors.length === 1 ? ors[0]! : { OR: ors };
}

function stornoMonthWhere(values: string[]): Prisma.ContractWhereInput | null {
  const ors: Prisma.ContractWhereInput[] = [];
  for (const value of values) {
    if (value === EMPTY_FILTER_VALUE) {
      ors.push({
        OR: [{ commission: null }, { commission: { stornoDate: null } }],
      });
      continue;
    }
    const range = monthRange(value);
    if (range) ors.push({ commission: { stornoDate: range } });
  }
  if (ors.length === 0) return null;
  return ors.length === 1 ? ors[0]! : { OR: ors };
}

/** Agenzia mostrata: valore salvato sul contratto, altrimenti derivata dal fornitore. */
function agencyWhere(
  values: string[],
  ctx: ProvvigioniFilterContext,
): Prisma.ContractWhereInput | null {
  const ors: Prisma.ContractWhereInput[] = [];
  for (const value of values) {
    const derivedIds = ctx.suppliers
      .filter((s) => agencyFromSupplierName(s.name) === value)
      .map((s) => s.id);
    if (value !== EMPTY_FILTER_VALUE) {
      ors.push({ agency: { equals: value, mode: "insensitive" } });
    }
    if (derivedIds.length > 0) {
      ors.push({
        AND: [
          { OR: [{ agency: null }, { agency: "" }] },
          { supplierId: { in: derivedIds } },
        ],
      });
    }
  }
  if (ors.length === 0) return null;
  return ors.length === 1 ? ors[0]! : { OR: ors };
}

/** Etichetta tipo operazione → valori grezzi presenti a database. */
function operationTypeWhere(
  values: string[],
  ctx: ProvvigioniFilterContext,
): Prisma.ContractWhereInput | null {
  const raws: string[] = [];
  let includeEmpty = false;
  for (const raw of ctx.operationTypes) {
    if (!values.includes(operationTypeLabel(raw))) continue;
    if (raw == null || raw.trim() === "") includeEmpty = true;
    else raws.push(raw);
  }
  const ors: Prisma.ContractWhereInput[] = [];
  if (raws.length > 0) ors.push({ operationType: { in: raws } });
  if (includeEmpty) {
    ors.push({ OR: [{ operationType: null }, { operationType: "" }] });
  }
  if (ors.length === 0) return { id: "__nessun_risultato__" };
  return ors.length === 1 ? ors[0]! : { OR: ors };
}

function parseAmount(value: string): number | null {
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Gettone mostrato: `commission.expected` se > 0, altrimenti il gettone di listino
 * per i domestici del fornitore (`defaultGettonePrivato`), altrimenti 0.
 */
function amountWhere(
  values: string[],
  ctx: ProvvigioniFilterContext,
): Prisma.ContractWhereInput | null {
  const ors: Prisma.ContractWhereInput[] = [];
  const noExpected: Prisma.ContractWhereInput = {
    OR: [{ commission: null }, { commission: { expected: 0 } }],
  };
  const suppliersWithDefault = ctx.suppliers.filter(
    (s) => defaultGettonePrivato(s.name) != null,
  );

  for (const value of values) {
    const target = parseAmount(value);
    if (target == null) continue;
    if (target > 0) {
      ors.push({ commission: { expected: target } });
      const ids = suppliersWithDefault
        .filter((s) => defaultGettonePrivato(s.name) === target)
        .map((s) => s.id);
      if (ids.length > 0) {
        ors.push({
          AND: [
            noExpected,
            { client: { type: "PRIVATO" } },
            { supplierId: { in: ids } },
          ],
        });
      }
      continue;
    }
    // Zero: nessun gettone atteso e nessun listino domestico applicabile.
    const defaultIds = suppliersWithDefault.map((s) => s.id);
    ors.push({
      AND: [
        noExpected,
        {
          OR: [
            { client: { type: { not: "PRIVATO" } } },
            ...(defaultIds.length > 0
              ? [{ supplierId: { notIn: defaultIds } }]
              : []),
          ],
        },
      ],
    });
  }
  if (ors.length === 0) return null;
  return ors.length === 1 ? ors[0]! : { OR: ors };
}

function stornoAmountWhere(values: string[]): Prisma.ContractWhereInput | null {
  const ors: Prisma.ContractWhereInput[] = [];
  for (const value of values) {
    if (value === EMPTY_FILTER_VALUE) {
      ors.push({
        OR: [{ commission: null }, { commission: { stornoAmount: null } }],
      });
      continue;
    }
    const amount = parseAmount(value);
    if (amount != null) ors.push({ commission: { stornoAmount: amount } });
  }
  if (ors.length === 0) return null;
  return ors.length === 1 ? ors[0]! : { OR: ors };
}

function clientNameWhere(text: string): Prisma.ContractWhereInput {
  const q = text.trim();
  return {
    client: {
      OR: [
        { companyName: { contains: q, mode: "insensitive" } },
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
      ],
    },
  };
}

function podWhere(text: string): Prisma.ContractWhereInput {
  const q = text.trim();
  return {
    OR: [
      { podPdr: { contains: q, mode: "insensitive" } },
      { pod: { contains: q, mode: "insensitive" } },
      { pdr: { contains: q, mode: "insensitive" } },
    ],
  };
}

export type ColumnFilterWhere = {
  /** Vale per ogni riga (unità e rata). */
  contract: Prisma.ContractWhereInput[];
  /** Vale solo per le righe «unità» (UT, annuale, in pagamento). */
  unitOnly: Prisma.ContractWhereInput[];
  /** Vale solo per le righe rata (`RecurringMonth`). */
  rate: Prisma.RecurringMonthWhereInput[];
  /** Un filtro riguarda un dato che esiste solo sulle rate: niente righe unità. */
  excludeUnitRows: boolean;
};

/**
 * Traduce i filtri colonna in clausole Prisma.
 *
 * `amount` e `collectionMonth` si applicano alla rata quando la lista è espansa
 * per mese, perché in quella modalità la cella mostra il valore della rata.
 */
export function buildColumnFilterWhere(
  filters: ProvvigioniColumnFilters,
  ctx: ProvvigioniFilterContext,
  opts?: { expanded?: boolean },
): ColumnFilterWhere {
  const expanded = opts?.expanded ?? false;
  const out: ColumnFilterWhere = {
    contract: [],
    unitOnly: [],
    rate: [],
    excludeUnitRows: false,
  };
  const push = (
    target: Prisma.ContractWhereInput[],
    where: Prisma.ContractWhereInput | null,
  ) => {
    if (where) target.push(where);
  };

  if (filters.clientName?.[0]) {
    out.contract.push(clientNameWhere(filters.clientName[0]));
  }
  if (filters.podPdr?.[0]) out.contract.push(podWhere(filters.podPdr[0]));
  if (filters.notes?.[0]) {
    out.contract.push({
      notes: { contains: filters.notes[0].trim(), mode: "insensitive" },
    });
  }
  if (filters.agency?.length) {
    push(out.contract, agencyWhere(filters.agency, ctx));
  }
  if (filters.operationType?.length) {
    push(out.contract, operationTypeWhere(filters.operationType, ctx));
  }
  if (filters.recurrence?.length) {
    const kinds = filters.recurrence.filter((v) =>
      ["UT", "M", "R"].includes(v),
    ) as Array<"UT" | "M" | "R">;
    if (kinds.length > 0) out.contract.push({ recurrenceKind: { in: kinds } });
  }
  if (filters.supplyStartDate?.length) {
    push(out.contract, dateMonthsWhere("supplyStartDate", filters.supplyStartDate));
  }
  if (filters.stornoFlag?.length) {
    const wantsYes = filters.stornoFlag.includes("Sì");
    const wantsNo = filters.stornoFlag.includes("No");
    if (wantsYes && !wantsNo) {
      out.contract.push({ commission: { stornoDate: { not: null } } });
    } else if (wantsNo && !wantsYes) {
      out.contract.push({
        OR: [{ commission: null }, { commission: { stornoDate: null } }],
      });
    }
  }
  if (filters.stornoMonth?.length) {
    push(out.contract, stornoMonthWhere(filters.stornoMonth));
  }
  if (filters.stornoAmount?.length) {
    push(out.contract, stornoAmountWhere(filters.stornoAmount));
  }

  // Mese di riferimento: esiste solo sulle rate.
  const mesi = (filters.meseRif ?? []).filter((v) => /^\d{4}-\d{2}$/.test(v));
  if (filters.meseRif?.length) {
    if (mesi.length > 0) {
      out.rate.push({ period: { in: mesi } });
      if (!expanded) {
        out.contract.push({ recurringMonths: { some: { period: { in: mesi } } } });
      }
    }
    out.excludeUnitRows = true;
  }

  // Mese di incasso: rata → mese pagamento (settledPeriod) se c'è, altrimenti competenza.
  if (filters.collectionMonth?.length) {
    const periods = filters.collectionMonth.filter((v) =>
      /^\d{4}-\d{2}$/.test(v),
    );
    const unitWhere = dateMonthsWhere("collectionDate", filters.collectionMonth);
    if (expanded) {
      if (periods.length > 0) {
        out.rate.push({
          OR: [
            { settledPeriod: { in: periods } },
            {
              AND: [{ settledPeriod: null }, { period: { in: periods } }],
            },
          ],
        });
      }
      push(out.unitOnly, unitWhere);
    } else {
      push(out.contract, unitWhere);
    }
  }

  // Gettone: in lista espansa la cella mostra l'importo della rata.
  if (filters.amount?.length) {
    const contractAmount = amountWhere(filters.amount, ctx);
    if (expanded) {
      const numbers = filters.amount
        .map(parseAmount)
        .filter((n): n is number => n != null);
      const rateOrs: Prisma.RecurringMonthWhereInput[] = [];
      if (numbers.length > 0) rateOrs.push({ amount: { in: numbers } });
      if (contractAmount) {
        rateOrs.push({
          AND: [
            { OR: [{ amount: null }, { amount: { lte: 0 } }] },
            { contract: contractAmount },
          ],
        });
      }
      if (rateOrs.length > 0) {
        out.rate.push(rateOrs.length === 1 ? rateOrs[0]! : { OR: rateOrs });
      }
      push(out.unitOnly, contractAmount);
    } else {
      push(out.contract, contractAmount);
    }
  }

  return out;
}

/** Unisce le clausole «contratto» in un unico where (o `undefined` se vuoto). */
export function columnFilterContractWhere(
  where: ColumnFilterWhere,
): Prisma.ContractWhereInput | undefined {
  if (where.contract.length === 0) return undefined;
  return { AND: where.contract };
}
