/**
 * Normalizzazione nomi fornitore (senza dipendenze server/DB).
 * Usabile da componenti client e da logica server.
 */

/** Toglie eventuali suffissi tipo «(unito in Enel)» da vecchi merge. */
export function stripMergedSupplierLabel(raw: string): string {
  return String(raw ?? "")
    .replace(/\s*\(unito in [^)]+\)\s*/gi, "")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Normalizza il nome fornitore (ignora maiuscole / varianti commerciali).
 * Enel / Enel Energia / ENEL BOX → «Enel»
 * Edison / Edison Energia → «Edison»
 */
export function canonicalSupplierName(raw: string): string {
  const n = stripMergedSupplierLabel(raw);
  if (!n) return n;
  const key = n
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (
    key === "enel" ||
    key.startsWith("enel ") ||
    key.startsWith("enelenergia") ||
    key.startsWith("enelbox")
  ) {
    return "Enel";
  }

  if (
    key === "edison" ||
    key.startsWith("edison ") ||
    key.startsWith("edisonenergia")
  ) {
    return "Edison";
  }

  if (key.includes("etrurialucegas") || key.includes("etruria luce gas")) {
    return "Etrurialucegas";
  }

  if (key.includes("duferco")) {
    return "Duferco Energia";
  }

  if (key.includes("eni") && (key.includes("plenitude") || key.includes("pleni"))) {
    return "Eni Plenitude";
  }

  return n;
}
