/**
 * Dati per il foglio/PDF «Rendiconto»: Incassato + Storni (+ ricorrenti)
 * con subtotali per mese e totale netto.
 */
import { formatCurrency } from "@/lib/commission";
import { formatMonthLabel } from "@/lib/report-month";
import type { ReportRecurringRow } from "@/lib/report-recurring";
import type { ReportStornoRow } from "@/lib/report-stornos";
import { isRecurring } from "@/lib/recurring";
import { clientDisplayName } from "@/lib/utils";

export type RendicontoIncassatoSource = {
  contractNumber: string;
  collectionDate: Date | null;
  insertionDate: Date;
  collaborator: { name: string };
  supplier: { name: string };
  client: Parameters<typeof clientDisplayName>[0];
  commission: { received: unknown; expected: unknown } | null;
  recurrence: string | null;
};

export type RendicontoLine = {
  kind: "incassato" | "storno" | "ricorrente";
  month: string;
  contractNumber: string;
  clientName: string;
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

export type RendicontoSummary = {
  months: RendicontoMonthBlock[];
  totIncassato: number;
  totStorni: number;
  totRicorrenti: number;
  totNetto: number;
  countIncassato: number;
  countStorni: number;
  countRicorrenti: number;
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
        supplierName: c.supplier.name,
        collaboratorName: c.collaborator.name,
        amount: Number(c.commission?.received ?? 0),
        dateLabel: isoDate(c.collectionDate) || isoDate(c.insertionDate),
      });
    }
  }

  for (const s of params.stornoRows) {
    lines.push({
      kind: "storno",
      month: s.period,
      contractNumber: s.contractNumber,
      clientName: s.clientName,
      supplierName: s.supplierName,
      collaboratorName: s.collaboratorName,
      amount: s.amount,
      dateLabel: isoDate(s.stornoDate),
    });
  }

  if (!params.skipRecurring) {
    for (const r of params.recurringRows) {
      const month = r.settledPeriod || r.period;
      lines.push({
        kind: "ricorrente",
        month,
        contractNumber: r.contractNumber,
        clientName: r.clientName,
        supplierName: r.supplierName,
        collaboratorName: r.collaboratorName,
        amount: r.amount,
        dateLabel: r.period,
      });
    }
  }

  const monthKeys = [...new Set(lines.map((l) => l.month))].sort();
  const months: RendicontoMonthBlock[] = monthKeys.map((month) => {
    const ofMonth = lines.filter((l) => l.month === month);
    const incassato = ofMonth.filter((l) => l.kind === "incassato");
    const storni = ofMonth.filter((l) => l.kind === "storno");
    const ricorrenti = ofMonth.filter((l) => l.kind === "ricorrente");
    const subIncassato = incassato.reduce((s, l) => s + l.amount, 0);
    const subStorni = storni.reduce((s, l) => s + l.amount, 0);
    const subRicorrenti = ricorrenti.reduce((s, l) => s + l.amount, 0);
    return {
      month,
      label: formatMonthLabel(month),
      incassato,
      storni,
      ricorrenti,
      subIncassato,
      subStorni,
      subRicorrenti,
      subNetto: subIncassato + subStorni + subRicorrenti,
      countIncassato: incassato.length,
      countStorni: storni.length,
      countRicorrenti: ricorrenti.length,
    };
  });

  const totIncassato = months.reduce((s, m) => s + m.subIncassato, 0);
  const totStorni = months.reduce((s, m) => s + m.subStorni, 0);
  const totRicorrenti = months.reduce((s, m) => s + m.subRicorrenti, 0);

  return {
    months,
    totIncassato,
    totStorni,
    totRicorrenti,
    totNetto: totIncassato + totStorni + totRicorrenti,
    countIncassato: months.reduce((s, m) => s + m.countIncassato, 0),
    countStorni: months.reduce((s, m) => s + m.countStorni, 0),
    countRicorrenti: months.reduce((s, m) => s + m.countRicorrenti, 0),
  };
}

export function formatEuro(n: number): string {
  return formatCurrency(n);
}
