/**
 * Dati per il foglio/PDF «Rendiconto»: Incassato + Storni (+ ricorrenti)
 * con subtotali per mese e totale netto.
 */
import { formatCurrency } from "@/lib/commission";
import { effectiveGettone } from "@/lib/provvigioni-stato";
import { formatMonthLabel } from "@/lib/report-month";
import {
  groupReportRecurringByContract,
  type ReportRecurringRow,
} from "@/lib/report-recurring";
import type { ReportStornoRow } from "@/lib/report-stornos";
import { isRecurring } from "@/lib/recurring";
import { clientDisplayName } from "@/lib/utils";

export type RendicontoIncassatoSource = {
  contractNumber: string;
  collectionDate: Date | null;
  insertionDate: Date;
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

/** Raggruppa le righe per fornitore (A→Z) con subtotale. */
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
    .sort((a, b) => a[0].localeCompare(b[0], "it"))
    .map(([supplierName, group]) => ({
      supplierName,
      lines: group,
      subtotal: group.reduce((s, row) => s + row.amount, 0),
      count: group.length,
    }));
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
}): RendicontoSummary {
  const lines: RendicontoLine[] = [];

  if (!params.onlyStornato) {
    for (const c of params.contracts) {
      // Le rate R sono già nel foglio ricorrenti: evita doppio conteggio
      if (isRecurring(c.recurrence)) continue;
      const base = c.collectionDate ?? c.insertionDate;
      const month = monthKeyFromDate(new Date(base));
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
