/**
 * Voci manuali opzionali nel Report export (Acconti precedenti, ecc.).
 * Ogni voce: tipologia + importo + note; gli importi si sommano al totale netto.
 */

export type ReportExtraLine = {
  /** Es. «Acconti precedenti» */
  tipologia: string;
  amount: number;
  note: string;
};

function parseAmount(raw: string | null | undefined): number | null {
  const t = (raw ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Legge fino a 3 voci da query string (extra1Type / extra1Amount / extra1Note …). */
export function parseReportExtras(get: (key: string) => string | null): ReportExtraLine[] {
  const out: ReportExtraLine[] = [];
  for (let i = 1; i <= 3; i++) {
    const tipologia = (get(`extra${i}Type`) ?? "").trim();
    const amount = parseAmount(get(`extra${i}Amount`));
    const note = (get(`extra${i}Note`) ?? "").trim();
    // Includi solo se c’è tipologia o un importo valorizzato
    if (!tipologia && amount == null) continue;
    out.push({
      tipologia: tipologia || `Voce extra ${i}`,
      amount: amount ?? 0,
      note,
    });
  }
  return out;
}

export function sumReportExtras(extras: ReportExtraLine[]): number {
  return extras.reduce((s, e) => s + e.amount, 0);
}

/** Suggerimenti tipologia (primo campo precompilabile). */
export const REPORT_EXTRA_TYPE_SUGGESTIONS = [
  "Acconti precedenti",
  "Conguaglio",
  "Bonus / premio",
] as const;
