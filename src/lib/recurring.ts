/** Periodo YYYY-MM */
export function toPeriod(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function periodLabel(period: string): string {
  const [y, m] = period.split("-");
  const months = [
    "gen",
    "feb",
    "mar",
    "apr",
    "mag",
    "giu",
    "lug",
    "ago",
    "set",
    "ott",
    "nov",
    "dic",
  ];
  const mi = Number(m) - 1;
  return `${months[mi] ?? m} ${y}`;
}

export function parsePeriod(period: string): Date {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

export function addMonths(period: string, n: number): string {
  const d = parsePeriod(period);
  d.setMonth(d.getMonth() + n);
  return toPeriod(d);
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  // max 60 mesi di sicurezza
  for (let i = 0; i < 60; i++) {
    if (cur > to) break;
    out.push(cur);
    cur = addMonths(cur, 1);
  }
  return out;
}

export const RECURRING_STATUS_LABELS: Record<string, string> = {
  PAID: "Pagato",
  PENDING: "In attesa",
  MISSING: "Mancato",
  CLOSED: "Chiuso",
  ERROR_UNPAID: "Non pagato (errore)",
};

export function isRecurring(recurrence: string | null | undefined): boolean {
  return /ricor|mensil/i.test(recurrence ?? "");
}
