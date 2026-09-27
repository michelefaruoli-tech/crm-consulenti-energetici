/**
 * P1.1 B6 — aggregati finanziari e timeline scheda contratto (sola lettura).
 *
 * Fonte dati: Commission + RecurringMonth + PayoutRow + PayoutAdjustment.
 * D5: gli adjustment compaiono in sezione dedicata sotto la timeline e
 * non entrano nei 6 totali (evita doppi conteggi / distorsioni).
 */

import { periodLabel, RECURRING_STATUS_LABELS } from "@/lib/recurring";

export type ContractFinanceKind = "UT" | "M" | "R";

export type ContractFinanceTotals = {
  /** Somma attese (UT: expected; M/R: rate non CLOSED). */
  attese: number;
  /** Incassato dal fornitore (UT: received effettivo; M/R: PAID+LIQUIDATED). */
  incassato: number;
  /** Ancora da incassare dal fornitore. */
  daIncassare: number;
  /** Incassato ma non ancora liquidato al collaboratore. */
  daLiquidare: number;
  /** Liquidato al collaboratore. */
  liquidato: number;
  /**
   * Solo storno gettone su Commission (importo assoluto).
   * PayoutAdjustment NON inclusi (D5).
   */
  stornatoRettificato: number;
};

export type ContractFinanceTimelineRow = {
  id: string;
  /** YYYY-MM o etichetta sintetica */
  period: string;
  periodLabel: string;
  kind: ContractFinanceKind;
  atteso: number;
  incassato: number;
  liquidato: number;
  stato: string;
  fonte: string;
  note: string;
  /** Link a ciclo liquidazioni o vista Provvigioni. */
  href: string | null;
  hrefLabel: string | null;
  /** Ordinamento cronologico (più recente prima). */
  sortKey: string;
};

export type ContractFinanceAdjustmentRow = {
  id: string;
  kind: string;
  kindLabel: string;
  amount: number;
  note: string;
  period: string;
  periodLabel: string;
  voided: boolean;
  href: string;
  createdAt: Date;
};

export type ContractFinanceInput = {
  recurrenceKind: ContractFinanceKind;
  contractStatus: string;
  collectionDate: Date | null;
  commission: {
    expected: number;
    received: number;
    paid: number;
    stornoAmount: number;
    stornoDate: Date | null;
  } | null;
  recurringMonths: Array<{
    id: string;
    period: string;
    status: string;
    amount: number;
    paidAt: Date | null;
    settledPeriod: string | null;
    note: string | null;
  }>;
  commissionEntries: Array<{
    id: string;
    type: string;
    amount: number;
    note: string | null;
    createdAt: Date;
  }>;
  payoutRows: Array<{
    id: string;
    period: string | null;
    amount: number | null;
    recurringMonthId: string | null;
    matchStatus: string;
    appliedAt: Date | null;
    note: string | null;
    runId: string;
    sourceName: string;
  }>;
  adjustments: Array<{
    id: string;
    kind: string;
    amount: number;
    note: string;
    voidedAt: Date | null;
    createdAt: Date;
    runId: string;
    runPeriod: string;
  }>;
};

const ADJUSTMENT_KIND_LABELS: Record<string, string> = {
  EXTRA: "Extra",
  STORNO: "Storno liquidazione",
  ACCONTO: "Acconto",
  RETTIFICA: "Rettifica",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function utEffectiveReceived(
  commission: NonNullable<ContractFinanceInput["commission"]>,
  collectionDate: Date | null,
): number {
  if (collectionDate) return commission.received || commission.expected;
  return commission.received;
}

function recurringStatusLabel(status: string): string {
  return RECURRING_STATUS_LABELS[status] ?? status;
}

function utStatoLabel(input: ContractFinanceInput): string {
  const status = input.contractStatus;
  if (["KO", "ANNULLATO", "CHIUSO"].includes(status)) return "KO / Cessato";
  if (status === "STORNATO") return "Stornato";
  if (status === "PROVVIGIONE_LIQUIDATA") return "Liquidato";
  if (input.collectionDate) return "Incassato da liquidare";
  return "Da incassare";
}

function payoutByRecurringMonthId(
  rows: ContractFinanceInput["payoutRows"],
): Map<string, ContractFinanceInput["payoutRows"][number]> {
  const map = new Map<string, ContractFinanceInput["payoutRows"][number]>();
  for (const row of rows) {
    if (!row.recurringMonthId) continue;
    const prev = map.get(row.recurringMonthId);
    // Preferisci riga applicata; altrimenti la più recente
    if (!prev) {
      map.set(row.recurringMonthId, row);
      continue;
    }
    if (row.matchStatus === "APPLIED" && prev.matchStatus !== "APPLIED") {
      map.set(row.recurringMonthId, row);
      continue;
    }
    const rowTs = row.appliedAt?.getTime() ?? 0;
    const prevTs = prev.appliedAt?.getTime() ?? 0;
    if (rowTs >= prevTs) map.set(row.recurringMonthId, row);
  }
  return map;
}

function provvigioniHref(opts: {
  kind: ContractFinanceKind;
  period: string | null;
  stato?: string;
}): string {
  const params = new URLSearchParams();
  if (opts.kind === "M") params.set("vista", "mensile");
  if (opts.kind === "R") params.set("vista", "annuale");
  if (opts.period) params.set("competence", opts.period);
  if (opts.stato) params.set("stato", opts.stato);
  const qs = params.toString();
  return qs ? `/provvigioni?${qs}` : "/provvigioni";
}

/** Aggregati dei 6 totali — senza PayoutAdjustment (D5). */
export function buildContractFinanceTotals(
  input: ContractFinanceInput,
): ContractFinanceTotals {
  const c = input.commission;
  const storno = Math.abs(c?.stornoAmount ?? 0);

  if (input.recurrenceKind === "UT") {
    const expected = c?.expected ?? 0;
    const received = c ? utEffectiveReceived(c, input.collectionDate) : 0;
    const paid = c?.paid ?? 0;
    const isTerminal = ["KO", "ANNULLATO", "CHIUSO", "STORNATO"].includes(
      input.contractStatus,
    );
    const daIncassare =
      isTerminal || input.collectionDate || input.contractStatus === "PROVVIGIONE_LIQUIDATA"
        ? 0
        : Math.max(0, expected - received);
    return {
      attese: round2(expected),
      incassato: round2(received),
      daIncassare: round2(daIncassare),
      daLiquidare: round2(Math.max(0, received - paid)),
      liquidato: round2(paid),
      stornatoRettificato: round2(storno),
    };
  }

  const active = input.recurringMonths.filter((m) => m.status !== "CLOSED");
  let attese = 0;
  let incassato = 0;
  let daIncassare = 0;
  let daLiquidare = 0;
  let liquidato = 0;
  for (const m of active) {
    const amount = m.amount;
    attese += amount;
    if (m.status === "LIQUIDATED") {
      incassato += amount;
      liquidato += amount;
    } else if (m.status === "PAID") {
      incassato += amount;
      daLiquidare += amount;
    } else if (
      m.status === "PENDING" ||
      m.status === "MISSING" ||
      m.status === "ERROR_UNPAID"
    ) {
      daIncassare += amount;
    }
  }

  return {
    attese: round2(attese),
    incassato: round2(incassato),
    daIncassare: round2(daIncassare),
    daLiquidare: round2(daLiquidare),
    liquidato: round2(liquidato),
    stornatoRettificato: round2(storno),
  };
}

/** Righe cronologiche rate / gettone UT (senza adjustment). */
export function buildContractFinanceTimeline(
  input: ContractFinanceInput,
): ContractFinanceTimelineRow[] {
  const kind = input.recurrenceKind;
  const payoutMap = payoutByRecurringMonthId(input.payoutRows);
  const rows: ContractFinanceTimelineRow[] = [];

  if (kind === "UT") {
    const c = input.commission;
    if (c) {
      const received = utEffectiveReceived(c, input.collectionDate);
      const paid = c.paid;
      const stato = utStatoLabel(input);
      const period =
        input.collectionDate != null
          ? `${input.collectionDate.getFullYear()}-${String(input.collectionDate.getMonth() + 1).padStart(2, "0")}`
          : "—";
      const entryNotes = input.commissionEntries
        .map((e) => e.note?.trim())
        .filter(Boolean)
        .slice(0, 2)
        .join(" · ");
      const utPayout = input.payoutRows.find(
        (p) => !p.recurringMonthId && p.matchStatus === "APPLIED",
      );
      rows.push({
        id: "ut-commission",
        period,
        periodLabel: period === "—" ? "Una tantum" : periodLabel(period),
        kind: "UT",
        atteso: round2(c.expected),
        incassato: round2(received),
        liquidato: round2(paid),
        stato,
        fonte: utPayout?.sourceName ?? "Scheda / manuale",
        note: entryNotes || (c.stornoAmount ? "Storno gettone presente" : "—"),
        href: utPayout
          ? `/provvigioni/liquidazioni/${utPayout.runId}`
          : provvigioniHref({ kind: "UT", period: null, stato }),
        hrefLabel: utPayout ? "Ciclo liquidazione" : "Apri in Provvigioni",
        sortKey: input.collectionDate?.toISOString() ?? "0000",
      });
    }
  } else {
    for (const m of input.recurringMonths) {
      if (m.status === "CLOSED") continue;
      const payout = payoutMap.get(m.id);
      const isLiquidated = m.status === "LIQUIDATED";
      const isPaid = m.status === "PAID" || isLiquidated;
      const statoCanon =
        m.status === "LIQUIDATED"
          ? "Liquidato"
          : m.status === "PAID"
            ? "Incassato da liquidare"
            : m.status === "PENDING" ||
                m.status === "MISSING" ||
                m.status === "ERROR_UNPAID"
              ? "Da incassare"
              : recurringStatusLabel(m.status);
      rows.push({
        id: `rm-${m.id}`,
        period: m.period,
        periodLabel: periodLabel(m.period),
        kind,
        atteso: round2(m.amount),
        incassato: round2(isPaid ? m.amount : 0),
        liquidato: round2(isLiquidated ? m.amount : 0),
        stato: statoCanon,
        fonte: payout?.sourceName ?? "Rate / sync",
        note:
          m.note?.trim() ||
          (m.settledPeriod
            ? `Rendiconto ${periodLabel(m.settledPeriod)}`
            : "—"),
        href: payout
          ? `/provvigioni/liquidazioni/${payout.runId}`
          : provvigioniHref({
              kind,
              period: m.period,
              stato: statoCanon,
            }),
        hrefLabel: payout ? "Ciclo liquidazione" : "Apri in Provvigioni",
        sortKey: `${m.period}-${m.paidAt?.toISOString() ?? "0"}`,
      });
    }
  }

  // Riga storno gettone (Commission) se presente — informativa, già nei totali
  if (cHasStorno(input)) {
    const storno = Math.abs(input.commission!.stornoAmount);
    const d = input.commission!.stornoDate;
    const period = d
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      : "—";
    rows.push({
      id: "commission-storno",
      period,
      periodLabel: period === "—" ? "Storno gettone" : periodLabel(period),
      kind,
      atteso: 0,
      incassato: 0,
      liquidato: 0,
      stato: "Stornato",
      fonte: "Commission",
      note: `Storno gettone ${storno.toFixed(2)} €`,
      href: null,
      hrefLabel: null,
      sortKey: d?.toISOString() ?? "0001-storno",
    });
  }

  rows.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  return rows;
}

function cHasStorno(input: ContractFinanceInput): boolean {
  return Boolean(input.commission && input.commission.stornoAmount !== 0);
}

/** D5 — rettifiche payout: sezione sotto, etichette chiare, fuori dai totali. */
export function buildContractFinanceAdjustments(
  input: ContractFinanceInput,
): ContractFinanceAdjustmentRow[] {
  return input.adjustments
    .map((a) => ({
      id: a.id,
      kind: a.kind,
      kindLabel: ADJUSTMENT_KIND_LABELS[a.kind] ?? a.kind,
      amount: round2(a.amount),
      note: a.note,
      period: a.runPeriod,
      periodLabel: periodLabel(a.runPeriod),
      voided: a.voidedAt != null,
      href: `/provvigioni/liquidazioni/${a.runId}`,
      createdAt: a.createdAt,
    }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function buildContractFinanceView(input: ContractFinanceInput): {
  totals: ContractFinanceTotals;
  timeline: ContractFinanceTimelineRow[];
  adjustments: ContractFinanceAdjustmentRow[];
} {
  return {
    totals: buildContractFinanceTotals(input),
    timeline: buildContractFinanceTimeline(input),
    adjustments: buildContractFinanceAdjustments(input),
  };
}
