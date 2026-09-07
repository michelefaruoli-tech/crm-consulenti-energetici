import { canonicalSupplierName } from "@/lib/supplier-names";

export const HELIOS_MONTHLY_RESIDENTE = 4;
export const HELIOS_MONTHLY_ALTRO = 6;

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
