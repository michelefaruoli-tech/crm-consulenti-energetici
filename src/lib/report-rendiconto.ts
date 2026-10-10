/**
 * Dati per il foglio/PDF «Rendiconto»: Incassato + Storni (+ ricorrenti)
 * con subtotali per mese e totale netto.
 */
import { formatCurrency } from "@/lib/commission";
import { effectiveGettone } from "@/lib/provvigioni-stato";
import { reportHasStato } from "@/lib/report-filters";
import type { ReportExtraLine } from "@/lib/report-extras";
import { formatMonthLabel } from "@/lib/report-month";
import {
  groupReportRecurringByContract,
  type ReportRecurringRow,
} from "@/lib/report-recurring";
import type { ReportStornoRow } from "@/lib/report-stornos";
import { isRecurringAnnual, isRecurringMonthly } from "@/lib/recurring";
import { clientDisplayName } from "@/lib/utils";

export type RendicontoIncassatoSource = {
  contractNumber: string;
  collectionDate: Date | null;
  insertionDate: Date;
  status?: string | null;
  podPdr?: string | null;
  pod?: string | null;
  pdr?: string | null;
  collaborator: { name: string };
  supplier: { name: string };
  client: Parameters<typeof clientDisplayName>[0] & { type?: string };
  commission: { received: unknown; expected: unknown } | null;
  recurrence: string | null;
};

export function reportPodPdr(source: {
  podPdr?: string | null;
  pod?: string | null;
  pdr?: string | null;
}): string {
  return (source.podPdr || source.pod || source.pdr || "").trim();
}

/** Cliente con POD/PDR nella stessa colonna, solo se presente. */
export function reportClienteLabel(
  clientName: string,
  podPdr?: string | null,
): string {
  const name = clientName.trim() || "—";
  const pod = (podPdr || "").trim();
  return pod ? `${name} · ${pod}` : name;
}

/**
 * Importo «Incassato» nel Report = stesso gettone della colonna Gettone in Provvigioni
 * (`expected`, o default fornitore se expected è 0).
 * Non usare `received`: resta spesso al valore pre-modifica e sballa i totali.
 */
export function reportIncassatoAmount(
  commission: { received?: unknown; expected?: unknown } | null | undefined,
  context?: { clientType?: string; supplierName?: string },
): number {
  return effectiveGettone({
    expected: Number(commission?.expected ?? 0),
    clientType: context?.clientType ?? "",
    supplierName: context?.supplierName ?? "",
  });
}

export type RendicontoLine = {
  kind: "incassato" | "storno" | "ricorrente";
  month: string;
  contractNumber: string;
  clientName: string;
  podPdr: string;
  supplierName: string;
  collaboratorName: string;
  amount: number;
  /** Data leggibile (incasso / storno / competenza) */
  dateLabel: string;
};

export type RendicontoMonthBlock = {
  month: string;
  label: string;
  incassato: RendicontoLine[];
  /** Incassato già spezzato per fornitore (ordinato A→Z) */
  incassatoBySupplier: RendicontoSupplierBlock[];
  storni: RendicontoLine[];
  ricorrenti: RendicontoLine[];
  subIncassato: number;
  subStorni: number;
  subRicorrenti: number;
  subNetto: number;
  countIncassato: number;
  countStorni: number;
  countRicorrenti: number;
};

export type RendicontoSupplierBlock = {
  supplierName: string;
  lines: RendicontoLine[];
  subtotal: number;
  count: number;
};

/**
 * Ordine alfabetico del nominativo, senza distinguere maiuscole.
 * A parità di nome: POD/PDR, poi numero contratto.
 */
export function compareRendicontoLines(a: RendicontoLine, b: RendicontoLine): number {
  const byName = a.clientName.localeCompare(b.clientName, "it", {
    sensitivity: "base",
  });
  if (byName !== 0) return byName;
  const byPod = (a.podPdr || "").localeCompare(b.podPdr || "", "it", {
    sensitivity: "base",
  });
  if (byPod !== 0) return byPod;
  const byContract = a.contractNumber.localeCompare(b.contractNumber, "it", {
    sensitivity: "base",
  });
  if (byContract !== 0) return byContract;
  return a.dateLabel.localeCompare(b.dateLabel, "it", { sensitivity: "base" });
}

export function sortRendicontoLines(lines: RendicontoLine[]): RendicontoLine[] {
  return [...lines].sort(compareRendicontoLines);
}

/** Raggruppa le righe per fornitore (A→Z) con subtotale. Le righe sono A→Z per cliente. */
export function groupLinesBySupplier(
  lines: RendicontoLine[],
): RendicontoSupplierBlock[] {
  const map = new Map<string, RendicontoLine[]>();
  for (const l of lines) {
    const key = (l.supplierName || "").trim() || "(senza fornitore)";
    const arr = map.get(key) ?? [];
    arr.push(l);
    map.set(key, arr);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "it", { sensitivity: "base" }))
    .map(([supplierName, group]) => ({
      supplierName,
      lines: sortRendicontoLines(group),
      subtotal: group.reduce((s, row) => s + row.amount, 0),
      count: group.length,
    }));
}

/** Mese dentro la scheda di un fornitore. I totali sono quelli del blocco già calcolato. */
export type RendicontoMonthSlice = {
  month: string;
  label: string;
  lines: RendicontoLine[];
  subtotal: number;
  count: number;
};

/**
 * Una scheda = un fornitore. I mesi stanno dentro, non il contrario.
 * Incassato, storni e ricorrenti dello stesso fornitore condividono la scheda.
 */
export type RendicontoSupplierCardModel = {
  supplierName: string;
  months: RendicontoMonthSlice[];
  storniMonths: RendicontoMonthSlice[];
  ricorrenti: RendicontoLine[];
  incassatoSubtotal: number;
  incassatoCount: number;
  storniSubtotal: number;
  storniCount: number;
  ricorrentiSubtotal: number;
  ricorrentiCount: number;
};

/** Raggruppa il rendiconto per fornitore, con i mesi in ordine cronologico dentro. */
export function buildRendicontoSupplierCards(
  rendiconto: RendicontoSummary,
  options?: { includeStornos?: boolean; includeRecurring?: boolean },
): RendicontoSupplierCardModel[] {
  const includeStornos = options?.includeStornos !== false;
  const includeRecurring = options?.includeRecurring !== false;
  const cards = new Map<string, RendicontoSupplierCardModel>();

  function ensure(name: string): RendicontoSupplierCardModel {
    const existing = cards.get(name);
    if (existing) return existing;
    const created: RendicontoSupplierCardModel = {
      supplierName: name,
      months: [],
      storniMonths: [],
      ricorrenti: [],
      incassatoSubtotal: 0,
      incassatoCount: 0,
      storniSubtotal: 0,
      storniCount: 0,
      ricorrentiSubtotal: 0,
      ricorrentiCount: 0,
    };
    cards.set(name, created);
    return created;
  }

  for (const block of rendiconto.months) {
    for (const supplier of block.incassatoBySupplier) {
      const card = ensure(supplier.supplierName);
      card.months.push({
        month: block.month,
        label: block.label,
        lines: sortRendicontoLines(supplier.lines),
        subtotal: supplier.subtotal,
        count: supplier.count,
      });
    }
    if (includeStornos && block.storni.length > 0) {
      for (const supplier of groupLinesBySupplier(block.storni)) {
        const card = ensure(supplier.supplierName);
        card.storniMonths.push({
          month: block.month,
          label: block.label,
          lines: supplier.lines,
          subtotal: supplier.subtotal,
          count: supplier.count,
        });
        card.storniSubtotal += supplier.subtotal;
        card.storniCount += supplier.count;
      }
    }
  }

  if (includeRecurring) {
    for (const supplier of groupLinesBySupplier(rendiconto.ricorrentiGrouped)) {
      const card = ensure(supplier.supplierName);
      card.ricorrenti = supplier.lines;
      card.ricorrentiSubtotal = supplier.subtotal;
      card.ricorrentiCount = supplier.count;
    }
  }

  for (const official of rendiconto.incassatoBySupplier) {
    const card = ensure(official.supplierName);
    card.incassatoSubtotal = official.subtotal;
    card.incassatoCount = official.count;
  }

  return [...cards.values()]
    .filter(
      (card) =>
        card.months.length > 0 ||
        card.storniMonths.length > 0 ||
        card.ricorrenti.length > 0,
    )
    .sort((a, b) =>
      a.supplierName.localeCompare(b.supplierName, "it", { sensitivity: "base" }),
    );
}

/** Testo della barra: stesso importo già presente nel riepilogo del fornitore. */
export function rendicontoSupplierCardHeading(card: RendicontoSupplierCardModel): {
  title: string;
  foot: string;
  amount: number;
} {
  if (card.incassatoCount > 0 || card.months.length > 0) {
    return {
      title: `${card.supplierName}  ·  ${rendicontoCountLabel(card.incassatoCount)}  ·  ${formatEuro(card.incassatoSubtotal)}`,
      foot: `Subtotale ${card.supplierName}`,
      amount: card.incassatoSubtotal,
    };
  }
  if (card.storniCount > 0) {
    const countLabel =
      card.storniCount === 1 ? "1 storno" : `${card.storniCount} storni`;
    return {
      title: `${card.supplierName}  ·  ${countLabel}  ·  ${formatEuro(card.storniSubtotal)}`,
      foot: `Subtotale storni ${card.supplierName}`,
      amount: card.storniSubtotal,
    };
  }
  return {
    title: `${card.supplierName}  ·  ${rendicontoCountLabel(card.ricorrentiCount)}  ·  ${formatEuro(card.ricorrentiSubtotal)}`,
    foot: `Subtotale ${card.supplierName}`,
    amount: card.ricorrentiSubtotal,
  };
}

export type RendicontoSummary = {
  months: RendicontoMonthBlock[];
  totIncassato: number;
  totStorni: number;
  totRicorrenti: number;
  totNetto: number;
  countIncassato: number;
  countStorni: number;
  countRicorrenti: number;
  /** Totali Incassato per fornitore su tutto il periodo */
  incassatoBySupplier: RendicontoSupplierBlock[];
  /** Ricorrenti raggruppate per contratto (mesi pagati in dateLabel) */
  ricorrentiGrouped: RendicontoLine[];
};

function monthKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function isoDate(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

/** Costruisce il rendiconto da contratti Incassato + storni + rate. */
export function buildRendiconto(params: {
  contracts: RendicontoIncassatoSource[];
  stornoRows: ReportStornoRow[];
  recurringRows: ReportRecurringRow[];
  /** Se true, non include le rate ricorrenti nel rendiconto */
  skipRecurring?: boolean;
  /** Se true (solo stato Stornato), non elenca i contratti come Incassato */
  onlyStornato?: boolean;
  /**
   * Da incassare: le rate mancanti entrano nei subtotali mensili
   * (stesso elenco di Provvigioni), non solo in coda.
   */
  inlineRecurring?: boolean;
  /**
   * Mesi YYYY-MM ammessi per le righe Incassato (periodo filtro).
   * Evita che Incassato|Stornato a settembre ripeschi Maggio/Agosto
   * (collectionDate storica) insieme allo storno negativo.
   */
  incassatoMonths?: string[] | null;
}): RendicontoSummary {
  const lines: RendicontoLine[] = [];
  const allowedIncassato =
    params.incassatoMonths && params.incassatoMonths.length > 0
      ? new Set(params.incassatoMonths)
      : null;
  /** Contratti già in storno nel report: non ridarli come gettone positivo. */
  const stornoContractNumbers = new Set(
    params.stornoRows.map((r) => r.contractNumber),
  );

  if (!params.onlyStornato) {
    /** Contratti già presenti come rate → non riduplicare nel blocco Incassato. */
    const recurringContractNumbers = new Set(
      params.recurringRows.map((r) => r.contractNumber),
    );
    for (const c of params.contracts) {
      // Mensili: solo via rate. Annuali (con o senza incasso, orfani) restano qui.
      if (isRecurringMonthly(c.recurrence)) continue;
      if (
        isRecurringAnnual(c.recurrence) &&
        recurringContractNumbers.has(c.contractNumber)
      ) {
        continue;
      }
      // Recuperato / in clawback: solo riga storno negativa, mai +gettone.
      if (c.status === "STORNATO") continue;
      if (stornoContractNumbers.has(c.contractNumber)) continue;
      const base = c.collectionDate ?? c.insertionDate;
      const month = monthKeyFromDate(new Date(base));
      // «Da incassare» (nessun incasso ancora): nessun vincolo di mese — non
      // ha un "mese di incasso" da rispettare (docs/regole-provvigioni.md).
      if (allowedIncassato && c.collectionDate && !allowedIncassato.has(month)) {
        continue;
      }
      lines.push({
        kind: "incassato",
        month,
        contractNumber: c.contractNumber,
        clientName: clientDisplayName(c.client),
        podPdr: reportPodPdr(c),
        supplierName: c.supplier.name,
        collaboratorName: c.collaborator.name,
        amount: reportIncassatoAmount(c.commission, {
          clientType: c.client.type ?? "",
          supplierName: c.supplier.name,
        }),
        dateLabel: isoDate(c.collectionDate) || isoDate(c.insertionDate),
      });
    }
  }

  if (!params.skipRecurring && params.inlineRecurring) {
    for (const r of params.recurringRows) {
      lines.push({
        kind: "incassato",
        month: r.period,
        contractNumber: r.contractNumber,
        clientName: r.clientName,
        podPdr: r.podPdr ?? "",
        supplierName: r.supplierName,
        collaboratorName: r.collaboratorName,
        amount: r.amount,
        dateLabel: r.period,
      });
    }
  }

  for (const s of params.stornoRows) {
    lines.push({
      kind: "storno",
      month: s.period,
      contractNumber: s.contractNumber,
      clientName: s.clientName,
      podPdr: s.podPdr ?? "",
      supplierName: s.supplierName,
      collaboratorName: s.collaboratorName,
      amount: s.amount,
      dateLabel: isoDate(s.stornoDate),
    });
  }

  const ricorrentiGrouped: RendicontoLine[] =
    params.skipRecurring || params.inlineRecurring
      ? []
      : groupReportRecurringByContract(params.recurringRows).map((g) => ({
        kind: "ricorrente" as const,
        month: g.periods[0] ?? "",
        contractNumber: g.contractNumber,
        clientName: g.clientName,
        podPdr: g.podPdr ?? "",
        supplierName: g.supplierName,
        collaboratorName: g.collaboratorName,
        amount: g.amount,
        dateLabel: g.paidMonthsLabel,
      }));

  const monthKeys = [...new Set(lines.map((l) => l.month))].sort();
  const months: RendicontoMonthBlock[] = monthKeys.map((month) => {
    const ofMonth = lines.filter((l) => l.month === month);
    const incassato = ofMonth.filter((l) => l.kind === "incassato");
    const storni = ofMonth.filter((l) => l.kind === "storno");
    const ricorrenti: RendicontoLine[] = [];
    const subIncassato = incassato.reduce((s, l) => s + l.amount, 0);
    const subStorni = storni.reduce((s, l) => s + l.amount, 0);
    return {
      month,
      label: formatMonthLabel(month),
      incassato,
      incassatoBySupplier: groupLinesBySupplier(incassato),
      storni,
      ricorrenti,
      subIncassato,
      subStorni,
      subRicorrenti: 0,
      subNetto: subIncassato + subStorni,
      countIncassato: incassato.length,
      countStorni: storni.length,
      countRicorrenti: 0,
    };
  });

  const totIncassato = months.reduce((s, m) => s + m.subIncassato, 0);
  const totStorni = months.reduce((s, m) => s + m.subStorni, 0);
  const totRicorrenti = ricorrentiGrouped.reduce((s, l) => s + l.amount, 0);
  const allIncassato = months.flatMap((m) => m.incassato);

  return {
    months,
    totIncassato,
    totStorni,
    totRicorrenti,
    totNetto: totIncassato + totStorni + totRicorrenti,
    countIncassato: months.reduce((s, m) => s + m.countIncassato, 0),
    countStorni: months.reduce((s, m) => s + m.countStorni, 0),
    countRicorrenti: ricorrentiGrouped.length,
    incassatoBySupplier: groupLinesBySupplier(allIncassato),
    ricorrentiGrouped,
  };
}

export function formatEuro(n: number): string {
  return formatCurrency(n);
}

/** Intestazione del blocco incassi: stessa regola di PDF, Excel e anteprima. */
export function rendicontoCollectedHeading(stati: readonly string[]): string {
  const list = [...stati];
  const onlyDaIncassare =
    reportHasStato(list, "Da incassare") &&
    !reportHasStato(list, "Incassato") &&
    !reportHasStato(list, "Pagato") &&
    !reportHasStato(list, "Tutti");
  return onlyDaIncassare
    ? "Da incassare per fornitore"
    : "Incassato per fornitore";
}

export function rendicontoCountLabel(count: number): string {
  return count === 1 ? "1 contratto" : `${count} contratti`;
}

export type RendicontoSummaryRowKind =
  | "supplier"
  | "storni"
  | "ricorrenti"
  | "extra"
  | "netto";

/** Riga del riepilogo in cima al rendiconto. Gli importi sono quelli già calcolati. */
export type RendicontoSummaryRow = {
  kind: RendicontoSummaryRowKind;
  label: string;
  note: string;
  amount: number;
};

/**
 * Riepilogo visuale (fornitori, storni, ricorrenti, voci, netto).
 * Non ricalcola i totali: ripete i valori del rendiconto e delle voci extra.
 */
export function buildRendicontoSummaryRows(input: {
  rendiconto: RendicontoSummary;
  extras?: ReportExtraLine[];
  includeRecurring: boolean;
  grandNetto: number;
}): RendicontoSummaryRow[] {
  const extras = input.extras ?? [];
  const rows: RendicontoSummaryRow[] = [];
  for (const supplier of input.rendiconto.incassatoBySupplier) {
    rows.push({
      kind: "supplier",
      label: supplier.supplierName,
      note: String(supplier.count),
      amount: supplier.subtotal,
    });
  }
  if (input.rendiconto.countStorni > 0 || input.rendiconto.totStorni !== 0) {
    rows.push({
      kind: "storni",
      label: "Storni",
      note: String(input.rendiconto.countStorni),
      amount: input.rendiconto.totStorni,
    });
  }
  if (input.includeRecurring && input.rendiconto.countRicorrenti > 0) {
    rows.push({
      kind: "ricorrenti",
      label: "Rate ricorrenti (somma)",
      note: String(input.rendiconto.countRicorrenti),
      amount: input.rendiconto.totRicorrenti,
    });
  }
  for (const extra of extras) {
    rows.push({
      kind: "extra",
      label: extra.tipologia,
      note: extra.note || "-",
      amount: extra.amount,
    });
  }
  const count =
    input.rendiconto.countIncassato +
    input.rendiconto.countStorni +
    input.rendiconto.countRicorrenti +
    extras.length;
  rows.push({
    kind: "netto",
    label: "TOTALE NETTO",
    note: String(count),
    amount: input.grandNetto,
  });
  return rows;
}
