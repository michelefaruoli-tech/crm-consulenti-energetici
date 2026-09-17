import { canonicalSupplierName } from "@/lib/supplier-names";
import { addMonths } from "@/lib/recurring";

export const HELIOS_MONTHLY_RESIDENTE = 4;
export const HELIOS_MONTHLY_ALTRO = 6;

/**
 * Helios paga nel mese corrente la mensilità di competenza di N mesi prima
 * (es. a settembre paga luglio → ultimo mese generabile a settembre = luglio).
 */
export const HELIOS_RECURRING_GENERATION_LAG_MONTHS = 2;

/** Ritardo generazione rate ricorrenti per fornitore (0 = mese calendario corrente). */
export function recurringGenerationLagMonths(
  supplierName: string | null | undefined,
): number {
  return isHeliosSupplier(supplierName) ? HELIOS_RECURRING_GENERATION_LAG_MONTHS : 0;
}

function validYearMonth(value: string | null | undefined): string | null {
  const period = String(value ?? "").trim();
  return /^\d{4}-\d{2}$/.test(period) ? period : null;
}

/** Competenza Helios dal mese di pagamento (settembre → luglio). */
export function heliosCompetenceFromPaymentMonth(paymentPeriod: string): string {
  return addMonths(paymentPeriod, -HELIOS_RECURRING_GENERATION_LAG_MONTHS);
}

/**
 * Mese riferimento Helios = competenza, mai il mese di pagamento/incasso.
 * Se foglio o selezione coincidono con il pagamento, si applica il lag di 2 mesi.
 */
export function resolveHeliosCompetencePeriod(opts: {
  selectedCompetence?: string | null;
  settledPeriod?: string | null;
  inferredPeriod?: string | null;
}): string {
  const selected = validYearMonth(opts.selectedCompetence);
  const settled = validYearMonth(opts.settledPeriod);
  const inferred = validYearMonth(opts.inferredPeriod);
  const inferredIsPayment = Boolean(inferred && settled && inferred === settled);

  if (inferred && !inferredIsPayment) {
    return inferred;
  }
  if (selected && settled && selected === settled) {
    return heliosCompetenceFromPaymentMonth(settled);
  }
  if (selected) return selected;
  if (settled) return heliosCompetenceFromPaymentMonth(settled);
  return inferred ?? "";
}

/** Fornitore Helios (nome canonico o variante). */
export function isHeliosSupplier(name: string | null | undefined): boolean {
  const raw = String(name ?? "").trim();
  if (!raw) return false;
  const canon = canonicalSupplierName(raw);
  const key = (canon || raw).toLowerCase();
  return key === "helios" || key.startsWith("helios ");
}

/**
 * Gettone mensile Helios:
 * - €4 per tutti i domestici / privati
 * - €6 per business / aziende
 */
export function heliosMonthlyCommission(opts: {
  clientType?: string | null;
  classification?: string | null;
}): number {
  const clientType = (opts.clientType ?? "").trim().toUpperCase();
  if (clientType === "AZIENDA" || clientType === "BUSINESS") {
    return HELIOS_MONTHLY_ALTRO;
  }
  return HELIOS_MONTHLY_RESIDENTE;
}

type HeliosListinoRule = {
  id: string;
  clientSegment: string;
  name: string;
  paymentType?: string;
  gettoneMensile?: number;
};

/** Sceglie la regola listino Helios più adatta a classificazione e segmento. */
export function pickHeliosListinoRule(
  rules: HeliosListinoRule[],
  clientType: "PRIVATO" | "AZIENDA",
  classification?: string,
): HeliosListinoRule | undefined {
  if (!rules.length) return undefined;

  const expected = heliosMonthlyCommission({ clientType, classification });
  const classNorm = (classification ?? "").trim().toLowerCase();

  const segmentMatchers: string[] = [];
  if (clientType === "AZIENDA") {
    if (classNorm) segmentMatchers.push(classNorm);
    segmentMatchers.push("business", "azienda", "tutti");
  } else {
    if (classNorm) segmentMatchers.push(classNorm);
    segmentMatchers.push("residente", "privato", "domestico", "tutti");
  }

  for (const seg of segmentMatchers) {
    const hit = rules.find((r) => {
      const cs = (r.clientSegment ?? "TUTTI").toLowerCase();
      const nm = r.name.toLowerCase();
      if (seg === "tutti") return cs === "tutti" || cs === "all";
      return cs.includes(seg) || nm.includes(seg);
    });
    if (hit) return hit;
  }

  const byAmount = rules.find(
    (r) => Number(r.gettoneMensile) === expected && expected > 0,
  );
  if (byAmount) return byAmount;

  const monthly = rules.find(
    (r) => (r.paymentType ?? "").toUpperCase() === "MENSILE",
  );
  if (monthly) return monthly;

  return rules[0];
}
