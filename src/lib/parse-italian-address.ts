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
 * Spezza una riga tipo:
 * - "Via Roma 12, 85025 Melfi PZ"
 * - "Arco Boccolicchio 8, Manfredonia FG"  (senza CAP)
 * - "via ARCO BUCCOLICCHIO, 8 MANFREDONIA, FG"
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

  let city = after.replace(/[.,;]+$/g, "").trim();

  // Senza CAP: "Via X 8 Manfredonia" oppure "Via X, 8 MANFREDONIA"
  if (!zipCode && !city) {
    const noCap = extractCityWithoutCap(before);
    before = noCap.streetPart;
    city = noCap.city;
  }

  const { street, streetNumber } = splitStreetAndNumber(before);

  return { street, streetNumber, zipCode, city, province };
}

/**
 * Estrae il comune dalla coda quando manca il CAP.
 * Es. "Arco Boccolicchio, 8 MANFREDONIA" → streetPart + city.
 */
function extractCityWithoutCap(before: string): {
  streetPart: string;
  city: string;
} {
  const t = before.trim();
  if (!t) return { streetPart: "", city: "" };

  // Pattern: …, N CITY  oppure  … N CITY (CITY = 1–4 parole senza cifre)
  const m = t.match(
    /^(.*?)[,\s]+(\d+[A-Za-z]?(?:\/\d+[A-Za-z]?)?)[,\s]+([A-Za-zÀ-ÖØ-öø-ÿ'’.\-\s]{2,})$/u,
  );
  if (m) {
    const city = (m[3] ?? "").trim().replace(/\s+/g, " ");
    // Evita di prendere pezzi di via lunghi come "città"
    if (city && !/\d/.test(city) && city.split(" ").length <= 4) {
      return {
        streetPart: `${(m[1] ?? "").trim()}, ${m[2]}`.replace(/^,\s*/, ""),
        city,
      };
    }
  }

  // Solo "MANFREDONIA" o "MANFREDONIA FG" già senza numero: se non c'è via tipica
  const onlyCity = t.match(/^([A-Za-zÀ-ÖØ-öø-ÿ'’.\-\s]{2,})$/u);
  if (onlyCity && !/^(via|viale|piazza|corso|largo|strada|contrada|arco)\b/i.test(t)) {
    const city = onlyCity[1]!.trim();
    if (city.split(" ").length <= 4) {
      return { streetPart: "", city };
    }
  }

  return { streetPart: t, city: "" };
}

function splitStreetAndNumber(before: string): {
  street: string;
  streetNumber: string;
} {
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
