/** Helper mesi Report — usabile anche da Client Components (niente Prisma). */

export const REPORT_MONTH_LABELS = [
  "Gennaio",
  "Febbraio",
  "Marzo",
  "Aprile",
  "Maggio",
  "Giugno",
  "Luglio",
  "Agosto",
  "Settembre",
  "Ottobre",
  "Novembre",
  "Dicembre",
] as const;

/** YYYY-MM → primo e ultimo giorno del mese (stringhe YYYY-MM-DD). */
export function monthToDateRange(month: string): { from: string; to: string } | null {
  const m = month.trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  const [yStr, moStr] = m.split("-");
  const y = Number(yStr);
  const mo = Number(moStr);
  if (!y || mo < 1 || mo > 12) return null;
  const from = `${yStr}-${moStr}-01`;
  const lastDay = new Date(y, mo, 0).getDate();
  const to = `${yStr}-${moStr}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

export function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-");
  const idx = Number(m) - 1;
  if (!y || idx < 0 || idx > 11) return month;
  return `${REPORT_MONTH_LABELS[idx]} ${y}`;
}

/** Ultimi N mesi (corrente incluso), dal più recente. */
export function recentMonthOptions(count = 24): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ value, label: formatMonthLabel(value) });
  }
  return out;
}

/** Mese corrente YYYY-MM. */
export function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function guessMonthFromRange(from: string, to: string): string | null {
  const range = monthToDateRange(from.slice(0, 7));
  if (range && range.from === from && range.to === to) return from.slice(0, 7);
  return null;
}

/** Mesi multipli da URL: `2026-05|2026-06` (separatore `|`). */
export function parseMonthList(raw: string | null | undefined): string[] {
  if (!raw?.trim() || raw.trim() === "custom") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split("|")) {
    const m = part.trim();
    if (!/^\d{4}-\d{2}$/.test(m) || seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out.sort();
}

/** Etichetta leggibile per uno o più mesi. */
export function formatMonthsLabel(months: string[]): string {
  if (months.length === 0) return "";
  if (months.length === 1) return formatMonthLabel(months[0]!);
  if (months.length === 2) {
    return `${formatMonthLabel(months[0]!)} + ${formatMonthLabel(months[1]!)}`;
  }
  return `${months.length} mesi (${formatMonthLabel(months[0]!)} … ${formatMonthLabel(months[months.length - 1]!)})`;
}

/**
 * Risolve from/to:
 * 1) se c'è `month` (anche più mesi con `|`) → unione di quei mesi
 * 2) altrimenti from/to passati (periodo personalizzato)
 * 3) altrimenti mese corrente
 *
 * Con più mesi: `from`/`to` = inizio del più vecchio → fine del più recente
 * (per Dal/Al); il filtro contratti usa l'unione dei mesi (anche non contigui).
 */
export function resolveReportPeriod(params: {
  from?: string | null;
  to?: string | null;
  month?: string | null;
}): { from: string; to: string; month: string | null; months: string[] } {
  const months = parseMonthList(params.month);
  if (months.length > 0) {
    const first = monthToDateRange(months[0]!);
    const last = monthToDateRange(months[months.length - 1]!);
    if (first && last) {
      return {
        from: first.from,
        to: last.to,
        month: months.join("|"),
        months,
      };
    }
  }

  if (params.from?.trim() && params.to?.trim()) {
    const guessed = guessMonthFromRange(params.from.trim(), params.to.trim());
    return {
      from: params.from.trim(),
      to: params.to.trim(),
      month: guessed,
      months: guessed ? [guessed] : [],
    };
  }

  const cur = currentMonthValue();
  const range = monthToDateRange(cur)!;
  return { ...range, month: cur, months: [cur] };
}
