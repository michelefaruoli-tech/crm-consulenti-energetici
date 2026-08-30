export function decimalToNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  return Number(value);
}

/** Gettone predefinito alla creazione contratto (€). */
export const DEFAULT_COMMISSION_PRIVATO = 40;
export const DEFAULT_COMMISSION_AZIENDA = 60;

/** Importo gettone di default in base al segmento cliente. */
export function defaultCommissionExpected(
  clientType: string | null | undefined,
): number {
  const t = (clientType ?? "").trim().toUpperCase();
  if (t === "AZIENDA" || t === "BUSINESS") return DEFAULT_COMMISSION_AZIENDA;
  return DEFAULT_COMMISSION_PRIVATO;
}

export function calculateExpectedCommission(
  rule: { fixedAmount?: unknown } | null,
  clientType?: string | null,
): number {
  const fromRule = rule ? decimalToNumber(rule.fixedAmount) : 0;
  if (fromRule > 0) return fromRule;
  return defaultCommissionExpected(clientType);
}

export function formatCurrency(value: unknown): string {
  const num = decimalToNumber(value);
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
  }).format(num);
}

export function paymentTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    MENSILE: "Mensile",
    UNA_TANTUM: "Una tantum",
    RATEIZZATO: "Rateizzato",
    BONUS: "Bonus",
    PREMIO: "Premio",
  };
  return labels[type] ?? type;
}

export function commissionDifference(
  expected: number,
  received: number,
  paid: number,
): { vsExpected: number; vsReceived: number } {
  return {
    vsExpected: received - expected,
    vsReceived: paid - received,
  };
}
