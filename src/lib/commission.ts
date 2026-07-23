export function decimalToNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  return Number(value);
}

export function calculateExpectedCommission(
  rule: { fixedAmount?: unknown } | null,
): number {
  if (!rule) return 0;
  return decimalToNumber(rule.fixedAmount);
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
