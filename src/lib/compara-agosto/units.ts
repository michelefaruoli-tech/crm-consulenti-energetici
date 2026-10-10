/** Legge la colonna Valore (1 o 2 Dual) dalla riga grezza Compara. */
export function readComparaUnits(raw: Record<string, string>): number {
  const direct = raw["Valore"] ?? raw["valore"] ?? "";
  const n = Number(String(direct).replace(",", ".").trim());
  if (Number.isFinite(n) && n >= 1) return Math.min(Math.round(n), 2);
  return 1;
}
