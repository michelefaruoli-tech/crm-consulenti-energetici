/** Validazioni formali documenti italiani (MVP). */

export function normalizeFiscalCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cf = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/.test(cf)) return null;
  return cf;
}

export function normalizeVat(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.replace(/\D/g, "");
  if (v.length !== 11) return null;
  return v;
}

export function normalizePod(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const pod = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^IT[A-Z0-9]{12,16}$/.test(pod)) return null;
  return pod;
}

export function normalizePdr(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 14) return null;
  return digits;
}

export function normalizeCap(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cap = raw.replace(/\D/g, "");
  if (cap.length !== 5) return null;
  return cap;
}

export function normalizePaymentMethod(
  raw: string | null | undefined,
): "BOLLETTINO" | "RID" | null {
  if (!raw) return null;
  const v = raw.toUpperCase();
  if (/BOLLETT|POSTAL/.test(v)) return "BOLLETTINO";
  if (/RID|SEPA|ADDEBIT|IBAN|BANCAR/.test(v)) return "RID";
  return null;
}

export function normalizeService(
  raw: string | null | undefined,
  pod?: string | null,
  pdr?: string | null,
): "LUCE" | "GAS" | "ALTRO" | null {
  const v = (raw ?? "").toUpperCase();
  if (/LUCE|ELETTR|ENERGIA|POD/.test(v) || pod) return "LUCE";
  if (/GAS|METANO|PDR/.test(v) || pdr) return "GAS";
  if (v) return "ALTRO";
  if (pod && pdr) return null; // dual gestito a parte
  if (pod) return "LUCE";
  if (pdr) return "GAS";
  return null;
}
