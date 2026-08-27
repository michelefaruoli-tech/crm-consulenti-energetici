import { normalizeProvinceSigla } from "@/lib/italy-cap-province";

export type ParsedItalianAddress = {
  street: string;
  streetNumber: string;
  zipCode: string;
  city: string;
  province: string;
};

/** Testo unico per UI. I pezzi restano separati in stato/DB (CAP e città analizzabili). */
export function formatItalianAddressLine(p: ParsedItalianAddress): string {
  const via = [p.street, p.streetNumber].filter(Boolean).join(" ").trim();
  const loc = [p.zipCode, p.city, p.province].filter(Boolean).join(" ").trim();
  if (via && loc) return `${via}, ${loc}`;
  return via || loc;
}

/**
 * Spezza una riga tipo "Via Roma 12, 85025 Melfi PZ".
 * Il CAP è 5 cifre; la provincia è sigla di 2 lettere a fine riga o tra parentesi.
 */
export function parseItalianAddressLine(raw: string): ParsedItalianAddress {
  let s = raw.trim().replace(/\s+/g, " ");
  if (!s) {
    return { street: "", streetNumber: "", zipCode: "", city: "", province: "" };
  }

  let province = "";
  const paren = s.match(/\(([A-Za-z]{2})\)\s*$/);
  if (paren && paren.index != null) {
    province = normalizeProvinceSigla(paren[1] ?? "");
    s = s.slice(0, paren.index).trim().replace(/[,\s]+$/, "");
  } else {
    const endSigla = s.match(/[,\s]([A-Za-z]{2})$/);
    if (endSigla && endSigla.index != null) {
      province = normalizeProvinceSigla(endSigla[1] ?? "");
      s = s.slice(0, endSigla.index).trim().replace(/[,\s]+$/, "");
    }
  }

  const zipMatch = s.match(/\b(\d{5})\b/);
  const zipCode = zipMatch?.[1] ?? "";
  let before = s;
  let after = "";
  if (zipMatch && zipMatch.index != null) {
    before = s.slice(0, zipMatch.index).trim().replace(/[,\s]+$/, "");
    after = s.slice(zipMatch.index + 5).trim().replace(/^[,\s]+/, "");
  }

  const city = after.replace(/[.,;]+$/g, "").trim();
  const { street, streetNumber } = splitStreetAndNumber(before);

  return { street, streetNumber, zipCode, city, province };
}

function splitStreetAndNumber(before: string): { street: string; streetNumber: string } {
  const t = before.trim();
  if (!t) return { street: "", streetNumber: "" };
  const m = t.match(/^(.*?)[,\s]+(\d+[A-Za-z]?(?:\/\d+[A-Za-z]?)?)$/);
  if (m) {
    return { street: (m[1] ?? "").trim(), streetNumber: (m[2] ?? "").trim() };
  }
  const tail = t.match(/^(.*\D)\s+(\d+[A-Za-z]?)$/);
  if (tail) {
    return { street: (tail[1] ?? "").trim(), streetNumber: (tail[2] ?? "").trim() };
  }
  return { street: t, streetNumber: "" };
}
