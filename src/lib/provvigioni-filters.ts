/**
 * Filtri condivisi Provvigioni (pagina + export Excel).
 * Solo contratti attivi (non storici, non eliminati).
 *
 * I filtri colonna (fornitore, stato, tipologia) sono server-side:
 * applicano a tutto il database, non solo alla pagina da 100 righe.
 */
import type { Prisma } from "@/generated/prisma/client";
import { contractTextSearchWhere } from "@/lib/list-search";
import {
  FILTER_LIST_SEP,
  formatFilterList,
  parseFilterList,
} from "@/lib/filter-list";
import { canonicalizeProvvigioneStato } from "@/lib/provvigioni-stato";
import { notAnnualNextHiddenWhere, toPeriod } from "@/lib/recurring";

export type ProvvigioniFilters = {
  canViewAll: boolean;
  sessionUserId: string;
  /** ID collaboratore (uno o più, separati da |) da query ?collab= */
  collab?: string | null;
  /** Nome fornitore (uno o più, separati da |) da ?supplier= */
  supplier?: string | null;
  /** Stato semplificato: uno o più (es. "Da incassare|Incassato da liquidare") */
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
  /**
   * Filtri di colonna (agenzia, tipo operazione, mese rif., gettone…) già
   * tradotti in clausole Prisma da `buildColumnFilterWhere`: qui entra la parte
   * valida per ogni riga, quelle per rata/riga unità le usa `provvigioni-rows`.
   */
  columnWhere?: Prisma.ContractWhereInput[] | null;
  /** Mese competenza YYYY-MM — allinea filtro Incassato/Liquidato alle rate mensili */
  competencePeriod?: string | null;
  /**
   * P1.2 B4: con filtro storno «Storico» non forzare `isHistorical: false`
   * (altrimenti l’OR con storico sarebbe sempre vuoto).
   */
  /**
   * Se `false`, nasconde i contratti `isHistorical` (POD ricontrattualizzato).
   * Default / `true`: restano in elenco (regola Michele: ogni contratto salvato
   * compare in Provvigioni; il badge Storico li distingue).
   */
  includeHistorical?: boolean;
};

/**
 * Filtri ricorrenza su `recurrenceKind` (colonna enum indicizzata).
 *
 * Prima si interrogava il testo libero `recurrence` con ILIKE '%ricor%': Postgres
 * non puo' usare un indice con wildcard iniziale, quindi ogni lista faceva una
 * scansione completa della tabella. `recurrenceKind` e' mantenuta in sync dalle
 * scritture tramite `recurrenceWriteData()` in src/lib/recurring.ts.
 */

/** Qualsiasi ricorrenza (mensile M o annuale R). */
export const recurringWhereOr: Prisma.ContractWhereInput[] = [
  { recurrenceKind: { in: ["M", "R"] } },
];

/** Solo ricorrenti mensili (M). */
export const recurringMonthlyWhereOr: Prisma.ContractWhereInput[] = [
  { recurrenceKind: "M" },
];

/** Solo ricorrenti annuali (R / 12 mesi). */
export const recurringAnnualWhereOr: Prisma.ContractWhereInput[] = [
  { recurrenceKind: "R" },
];

/** Gettone una tantum: tutto cio' che non e' ricorrente. */
export const nonRecurringWhere: Prisma.ContractWhereInput = {
  recurrenceKind: "UT",
};

export const KO_STATUSES = ["KO", "ANNULLATO", "CHIUSO"] as const;

/**
 * Contratti mensili ricorrenti (M) senza ancora nessuna rata `RecurringMonth`
 * generata: dati storici pre-PR #19, sync fallito in background, oppure
 * Helios ancora nel lag M+2 (nessuna competenza pagabile → sync non crea
 * rate, vedi docs/regola-helios-lag.md).
 *
 * Senza questo ramo i contratti sparivano da «Da incassare»: nessuna rata
 * da abbinare e stato normale (non IN_ATTESA_PAGAMENTO). Restano «Da
 * incassare» con il gettone previsto finché nasce la prima rata dovuta.
 *
 * Helios è incluso di proposito (richiesta Michele 2026-10): il contratto
 * salvato/inviato BO deve comparire subito in Provvigioni; il lag M+2
 * resta solo sulla *creazione* delle rate (non creare agosto a settembre).
 * Se poi c’è un problema, Michele mette KO a mano.
 */
export const neverSyncedMonthlyWhere: Prisma.ContractWhereInput = {
  AND: [
    { recurrenceKind: "M" },
    { status: { notIn: ["PROVVIGIONE_LIQUIDATA", "BOZZA", ...KO_STATUSES] } },
    { recurringMonths: { none: {} } },
  ],
};

export {
  FILTER_LIST_SEP,
  formatFilterList,
  parseFilterList,
} from "@/lib/filter-list";
/** @deprecated usa FILTER_LIST_SEP */
export const STATO_FILTER_SEP = FILTER_LIST_SEP;

/**
 * Parse + alias P1.1 B1/B8:
 * «Incassato da liquidare» ↔ Incassato (coda), «Liquidato» ↔ Pagato.
 * URL legacy `stato=Incassato` / `stato=Pagato` restano validi
 * (anche case / trattini / `+` via canonicalize).
 */
export function parseStatoFilter(raw: string | null | undefined): string[] {
  return parseFilterList(raw).map(canonicalizeProvvigioneStato);
}

export function formatStatoFilter(values: string[]): string | null {
  return formatFilterList(values);
}

/**
 * Filtro Prisma per stato semplificato (stessa logica Report + Provvigioni).
 *
 * Accetta un solo stato oppure più stati uniti con `|` (OR).
 * Alias UI (P1.1 B1): «Incassato da liquidare» → Incassato, «Liquidato» → Pagato.
 *
 * - Da controllare = inserito ma non ancora contrattualizzato (da visionare)
 * - Da incassare = atteso: fornitore non ha ancora pagato a te
 * - Incassato (= Incassato da liquidare) = fornitore ha pagato, da liquidare al collab.
 * - Pagato (= Liquidato) = già liquidato al collaboratore (PROVVIGIONE_LIQUIDATA)
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
  const s = canonicalizeProvvigioneStato(stato.trim());
  if (!s || s === "Tutti") return undefined;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (s === "Da controllare") {
    return { status: { equals: "DA_CONTROLLARE" } };
  }
  if (s === "Stornato") {
    // Da recuperare (Storno Sì) + già recuperati (status STORNATO).
    // Senza il ramo recuperati, Uccellatori/Davanzo spariscono dal Report.
    return {
      commission: {
        stornoDate: { not: null },
        stornoAmount: { not: null },
      },
      OR: [
        { status: "STORNATO" },
        {
          AND: [
            { status: { notIn: ["STORNATO", "DA_CONTROLLARE", ...KO_STATUSES] } },
            {
              OR: [
                {
                  AND: [
                    nonRecurringWhere,
                    { collectionDate: { not: null } },
                  ],
                },
                {
                  AND: [
                    { OR: recurringWhereOr },
                    {
                      recurringMonths: {
                        some: { status: { in: ["PAID", "LIQUIDATED"] } },
                      },
                    },
                  ],
                },
                {
                  AND: [
                    { OR: recurringAnnualWhereOr },
                    { collectionDate: { not: null } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
  }
  if (s === "Incassato") {
    const competence = opts?.competencePeriod?.trim();
    const excludedStatus = [
      "PROVVIGIONE_LIQUIDATA",
      "IN_ATTESA_PAGAMENTO",
      "DA_CONTROLLARE",
      "STORNATO",
      ...KO_STATUSES,
    ] as const;
    /** Solo PAID: LIQUIDATED = già liquidato al collaboratore (scheda Liquidato / alias Pagato). */
    const recurringPaid: Prisma.RecurringMonthWhereInput = {
      status: "PAID",
      ...(competence ? { period: competence } : {}),
    };
    /**
     * UT + R orfani: Incassato = collectionDate (come in tabella).
     * I R annuali spesso hanno gettone già incassato senza rate RecurringMonth
     * (la prima rata nasce solo a +12 mesi): senza questo ramo spariscono
     * da Incassato/report (es. Motta sotto Laforgia).
     */
    const collectedLikeUt: Prisma.ContractWhereInput = {
      AND: [
        {
          OR: [nonRecurringWhere, ...recurringAnnualWhereOr],
        },
        { collectionDate: { not: null } },
        {
          OR: [
            { supplyStartDate: { lte: today } },
            { supplyStartDate: null },
          ],
        },
      ],
    };
    return {
      status: { notIn: [...excludedStatus] },
      OR: [
        collectedLikeUt,
        {
          AND: [
            { OR: recurringWhereOr },
            { recurringMonths: { some: recurringPaid } },
          ],
        },
      ],
    };
  }
  if (s === "Da incassare") {
    const competence = opts?.competencePeriod?.trim();
    const missingRate: Prisma.RecurringMonthWhereInput = {
      status: { in: ["MISSING", "PENDING", "ERROR_UNPAID"] },
      ...(competence ? { period: competence } : {}),
      ...notAnnualNextHiddenWhere,
    };
    // BOZZA esclusa: in Provvigioni entrano solo contratti salvati (INSERITO+)
    // o inviati al BO — non le bozze incomplete.
    return {
      status: { notIn: ["BOZZA", "DA_CONTROLLARE", "STORNATO", ...KO_STATUSES] },
      OR: [
        { status: "IN_ATTESA_PAGAMENTO" },
        {
          AND: [
            nonRecurringWhere,
            { status: { not: "PROVVIGIONE_LIQUIDATA" } },
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
          AND: [
            { OR: recurringAnnualWhereOr },
            { collectionDate: null },
            { status: { not: "PROVVIGIONE_LIQUIDATA" } },
          ],
        },
        {
          AND: [
            { OR: recurringWhereOr },
            { recurringMonths: { some: missingRate } },
          ],
        },
        neverSyncedMonthlyWhere,
      ],
    };
  }
  if (s === "Pagato") {
    const competence = opts?.competencePeriod?.trim();
    return {
      OR: [
        { status: { equals: "PROVVIGIONE_LIQUIDATA" } },
        {
          AND: [
            { OR: recurringWhereOr },
            {
              recurringMonths: {
                some: {
                  status: "LIQUIDATED",
                  ...(competence ? { period: competence } : {}),
                },
              },
            },
          ],
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
  ];

  const statoParts = parseStatoFilter(stato);
  const includesKo = statoParts.includes("KO / Cessato");
  const onlyKo = includesKo && statoParts.length === 1;

  if (onlyKo) {
    // Solo KO: includi anche storici archiviati per poterli ripristinare
  } else if (includesKo) {
    // Misto (es. Incassato|KO): attivi non-KO oppure qualsiasi KO
    and.push({
      OR: [
        {
          AND: [
            ...(f.includeHistorical === false
              ? [{ isHistorical: false as const }]
              : []),
            { status: { notIn: [...KO_STATUSES] } },
          ],
        },
        { status: { in: [...KO_STATUSES] } },
      ],
    });
  } else {
    if (f.includeHistorical === false) {
      and.push({ isHistorical: false });
    }
    and.push({ status: { notIn: [...KO_STATUSES] } });
  }

  if (f.visibility && Object.keys(f.visibility).length > 0) {
    and.push(f.visibility);
  }

  for (const columnWhere of f.columnWhere ?? []) {
    and.push(columnWhere);
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
    const monthly = { OR: recurringMonthlyWhereOr };
    // In pagamento deve comparire in Da incassare anche se il contratto è R/UT.
    and.push(
      statoParts.includes("Da incassare")
        ? { OR: [monthly, { status: "IN_ATTESA_PAGAMENTO" }] }
        : monthly,
    );
  } else if (recurrenceMode === "annual") {
    and.push({ OR: recurringAnnualWhereOr });
  } else if (recurrenceMode === "exclude") {
    and.push(nonRecurringWhere);
  }

  return {
    deletedAt: null,
    ...(collaboratorFilter ? { collaboratorId: collaboratorFilter } : {}),
    ...(and.length ? { AND: and } : {}),
  };
}

export type ProvvigioniListFocus =
  | "da-confermare"
  | "ricorrenze-mancanti"
  | "fuori-storno"
  /** P1.1 B2 — coda operativa: fornitore ha pagato, collaboratore no. */
  | "incassato-da-liquidare"
  /** P1.1 B3 — una tantum (UT) ancora da incassare dal fornitore. */
  | "ut-da-incassare"
  /** P1.1 B5 — vista Anomalie unificata (sola lettura; apply in Backup). */
  | "anomalie";

/**
 * Parse focus URL (P1.1 B8: alias robusti).
 * Accetta slug canonici e varianti (`incassato`, `Incassato da liquidare`, `ut`, …).
 */
export function parseProvvigioniFocus(
  raw: string | null | undefined,
): ProvvigioniListFocus | undefined {
  if (!raw?.trim()) return undefined;
  const n = raw
    .trim()
    .replace(/\+/g, " ")
    .replace(/_/g, "-")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .replace(/-+/g, "-");

  if (
    n === "incassato-da-liquidare" ||
    n === "incassato" ||
    n === "incassatodaliquidare"
  ) {
    return "incassato-da-liquidare";
  }
  if (
    n === "ut-da-incassare" ||
    n === "ut" ||
    n === "una-tantum-da-incassare" ||
    n === "una-tantum"
  ) {
    return "ut-da-incassare";
  }
  if (n === "anomalie" || n === "anomalie-unificate" || n === "anomaly") {
    return "anomalie";
  }
  if (n === "da-confermare") return "da-confermare";
  if (n === "ricorrenze-mancanti" || n === "ricorrenze") {
    return "ricorrenze-mancanti";
  }
  if (n === "fuori-storno") return "fuori-storno";
  return undefined;
}

/**
 * P1.1 B8 — focus effettivo da query Dashboard/bookmark.
 * Focus esplicito vince; `stato=Incassato` (o alias UI) da solo → focus B2.
 * Non promuove `Da incassare` (troppo ampio vs UT-only).
 */
export function resolveProvvigioniFocusFromQuery(opts: {
  focus?: string | null;
  stato?: string | null;
}): ProvvigioniListFocus | undefined {
  const explicit = parseProvvigioniFocus(opts.focus);
  if (explicit) return explicit;

  const parts = parseStatoFilter(opts.stato);
  if (parts.length === 1 && parts[0] === "Incassato") {
    return "incassato-da-liquidare";
  }
  return undefined;
}

/**
 * Focus «Incassato da liquidare» = stesso bucket del filtro stato Incassato
 * (PAID / collectionDate, escluso Liquidato). Usato per expand rate e card.
 */
export function isIncassatoDaLiquidareFocus(
  focus: ProvvigioniListFocus | null | undefined,
): boolean {
  return focus === "incassato-da-liquidare";
}

/**
 * Focus «UT da incassare» = recurrenceKind UT + stato Da incassare.
 * Non include M (regola Michele: Da incassare card ≠ Ricorrenti mensili).
 */
export function isUtDaIncassareFocus(
  focus: ProvvigioniListFocus | null | undefined,
): boolean {
  return focus === "ut-da-incassare";
}

/** P1.1 B5 — vista Anomalie unificata (read-only). */
export function isAnomalieFocus(
  focus: ProvvigioniListFocus | null | undefined,
): boolean {
  return focus === "anomalie";
}

/**
 * Focus che definiscono un bucket proprio: non vanno AND-ati
 * sulle altre card summary (altrimenti gli altri totali diventano 0).
 */
export function isBucketSpecificFocus(
  focus: ProvvigioniListFocus | null | undefined,
): boolean {
  return (
    isIncassatoDaLiquidareFocus(focus) ||
    isUtDaIncassareFocus(focus) ||
    isAnomalieFocus(focus)
  );
}

/**
 * Stato effettivo per expand/lista: il focus B2 implica «Incassato», il focus
 * B3 implica «Da incassare», se l’URL non ha già un filtro stato.
 */
export function effectiveStatoForList(
  stato: string | null | undefined,
  focus?: ProvvigioniListFocus | null,
): string | undefined {
  const trimmed = stato?.trim() || undefined;
  if (trimmed) return trimmed;
  if (isIncassatoDaLiquidareFocus(focus)) return "Incassato";
  if (isUtDaIncassareFocus(focus)) return "Da incassare";
  return undefined;
}

/** Contratti con periodo storno già scaduto (o 0 mesi). */
export function fuoriStornoWhere(now = new Date()): Prisma.ContractWhereInput {
  return {
    status: { notIn: ["KO", "ANNULLATO", "CHIUSO", "STORNATO"] },
    OR: [
      { stornoEndDate: { lte: now } },
      { supplier: { stornoMonths: 0 } },
    ],
  };
}

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
  /**
   * Focus B2/B3: mapping su stati/ricorrenza esistenti (zero migration).
   * Iniettiamo nei filtri così card, lista ed export condividono lo stesso where.
   */
  let filters = opts.filters;
  if (
    opts.focus === "incassato-da-liquidare" &&
    !parseStatoFilter(filters.stato).includes("Incassato")
  ) {
    filters = { ...filters, stato: "Incassato" };
  }
  if (opts.focus === "ut-da-incassare") {
    filters = {
      ...filters,
      stato: parseStatoFilter(filters.stato).includes("Da incassare")
        ? filters.stato
        : "Da incassare",
      /** Solo UT (`nonRecurringWhere`); non M/R. */
      recurrenceMode: "exclude",
    };
  }

  let where = buildProvvigioniContractWhere(filters);

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
              ...notAnnualNextHiddenWhere,
            },
          },
        },
      ],
    };
  } else if (opts.focus === "fuori-storno") {
    /**
     * Legacy: preferire `?storno=fuori_storno` (B4). Se il caller ha già
     * applicato i filtri storno, non passare focus=fuori-storno.
     */
    where = { AND: [where, fuoriStornoWhere()] };
  } else if (opts.focus === "anomalie") {
    /**
     * P1.1 B5: contratti con almeno una anomalia operativa in scope
     * (rate mancanti/pending dovute, assenti Helios, fuori storno).
     * Duplicati POD / incongruenze integrity restano nel pannello read-only
     * (apply solo Backup) e non restringono ulteriormente la lista.
     */
    where = {
      AND: [
        where,
        {
          OR: [
            {
              recurringMonths: {
                some: {
                  status: { in: ["MISSING", "PENDING"] },
                  period: { lt: toPeriod(new Date()) },
                  ...notAnnualNextHiddenWhere,
                },
              },
            },
            {
              recurringMonths: {
                some: {
                  status: "ERROR_UNPAID",
                  note: { contains: "ASSENTE_RENDICONTO" },
                },
              },
            },
            fuoriStornoWhere(),
          ],
        },
      ],
    };
  }
  // focus=incassato-da-liquidare / ut-da-incassare: già mappati su filters sopra

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
  const monthOrs: Prisma.ContractWhereInput[] = [];
  if (stati.includes("Incassato")) {
    monthOrs.push({
      recurringMonths: { some: { period, status: "PAID" } },
    });
  }
  if (stati.includes("Pagato")) {
    monthOrs.push({
      recurringMonths: { some: { period, status: "LIQUIDATED" } },
    });
  }
  if (stati.includes("Da incassare")) {
    monthOrs.push({
      recurringMonths: {
        some: {
          period,
          status: { in: ["MISSING", "PENDING", "ERROR_UNPAID"] },
          ...notAnnualNextHiddenWhere,
        },
      },
    });
    monthOrs.push({ status: "IN_ATTESA_PAGAMENTO" });
  }
  if (stati.includes("Stornato") && monthOrs.length === 0) {
    monthOrs.push({
      recurringMonths: {
        some: { period, status: { in: ["PAID", "LIQUIDATED"] } },
      },
    });
  }
  if (monthOrs.length === 1) return monthOrs[0]!;
  if (monthOrs.length > 1) return { OR: monthOrs };
  return {
    OR: [
      { recurringMonths: { some: { period, status: { not: "CLOSED" } } } },
      { status: "IN_ATTESA_PAGAMENTO" },
    ],
  };
}

