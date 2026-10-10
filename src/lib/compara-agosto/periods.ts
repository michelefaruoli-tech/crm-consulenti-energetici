/**
 * Periodi Compara:
 * - Mese Invito (es. 202609) = mese rendiconto / pagamento (settled)
 * - Data riga (es. 31/08/2026) = competenza commerciale (tipicamente agosto)
 */

import { addMonths } from "@/lib/recurring";
import { parsePeriodCell, type RawCell } from "@/lib/payout/normalize";

/** YYYYMM numerico o stringa → YYYY-MM. */
export function periodFromMeseInvito(value: RawCell): string | null {
  return parsePeriodCell(value, "yyyymm") ?? parsePeriodCell(value, "auto");
}

/**
 * Deduce settled + competence dal file.
 * Se Mese Invito manca, usa la moda delle Date; competence = settled − 1 mese
 * quando tutte le Date cadono nel mese precedente all'invito.
 */
export function deduceComparaPeriods(params: {
  meseInvitoSamples: RawCell[];
  dataPeriods: Array<string | null>;
  fallbackCompetence: string;
  fallbackSettled: string;
}): { competencePeriod: string; settledPeriod: string; source: string } {
  let settled: string | null = null;
  for (const sample of params.meseInvitoSamples) {
    settled = periodFromMeseInvito(sample);
    if (settled) break;
  }

  const counts = new Map<string, number>();
  for (const p of params.dataPeriods) {
    if (!p) continue;
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  let competenceFromData: string | null = null;
  let best = 0;
  for (const [p, n] of counts) {
    if (n > best) {
      best = n;
      competenceFromData = p;
    }
  }

  if (settled && competenceFromData) {
    return {
      settledPeriod: settled,
      competencePeriod: competenceFromData,
      source: "Mese Invito + moda Data",
    };
  }
  if (settled) {
    return {
      settledPeriod: settled,
      competencePeriod: addMonths(settled, -1),
      source: "Mese Invito (competenza = invito − 1)",
    };
  }
  if (competenceFromData) {
    return {
      settledPeriod: addMonths(competenceFromData, 1),
      competencePeriod: competenceFromData,
      source: "moda Data (settled = data + 1)",
    };
  }
  return {
    settledPeriod: params.fallbackSettled,
    competencePeriod: params.fallbackCompetence,
    source: "fallback UI",
  };
}
