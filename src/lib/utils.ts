import { format } from "date-fns";
import { it } from "date-fns/locale";
import { splitItalianPersonName } from "@/lib/italian-person-name";

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return format(new Date(date), "dd/MM/yyyy", { locale: it });
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return format(new Date(date), "dd/MM/yyyy HH:mm", { locale: it });
}

/** Confronta due pezzi di nome ignorando maiuscole/accenti. */
function samePersonPart(a: string, b: string): boolean {
  return a.localeCompare(b, "it", { sensitivity: "accent" }) === 0;
}

/**
 * Da testo libero (Provvigioni / Helios) a campi DB Nome + Cognome.
 * La cella Cliente mostra «Cognome Nome»: in salvataggio si riparte da quel formato.
 * Riconosce anche «Nome Cognome» se il primo pezzo è un nome tipico italiano.
 */
export function parsePrivatoDisplayName(raw: string): {
  lastName: string;
  firstName: string | null;
} {
  let text = raw.trim().replace(/\s+/g, " ");
  const dupWhole = text.match(/^(.+?)\s+\1$/i);
  if (dupWhole) text = dupWhole[1].trim();

  const { firstName, lastName } = splitItalianPersonName(text);
  let first = firstName || null;
  const last = lastName || text;
  if (first && samePersonPart(first, last)) {
    first = null;
  }
  return { lastName: last, firstName: first };
}

export function clientDisplayName(client: {
  type: string;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string {
  if (client.type === "AZIENDA" && client.companyName) {
    return client.companyName;
  }
  const last = (client.lastName ?? "").trim();
  const first = (client.firstName ?? "").trim();
  // Import errati: nome = cognome → mostra una sola volta
  if (first && last && samePersonPart(first, last)) {
    return last || "Cliente senza nome";
  }
  // Cognome Nome (formato italiano richiesto ovunque: elenchi, report, contratti)
  return [last, first].filter(Boolean).join(" ") || "Cliente senza nome";
}

/** Chiave ordinamento cliente unica A→Z (senza split Domestico/Business). */
export function clientSortKey(client: {
  type?: string;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string {
  const company = (client.companyName ?? "").trim();
  const last = (client.lastName ?? "").trim();
  const first = (client.firstName ?? "").trim();
  const person =
    first && last && samePersonPart(first, last)
      ? last
      : [last, first].filter(Boolean).join(" ").trim();
  return (
    company ||
    person ||
    clientDisplayName({
      type: client.type ?? "PRIVATO",
      companyName: client.companyName,
      firstName: client.firstName,
      lastName: client.lastName,
    })
  ).toLocaleLowerCase("it");
}

export function isContractBlocked(status: string): boolean {
  return ["DOCUMENTAZIONE_INCOMPLETA", "IN_LAVORAZIONE", "IN_ATTESA_PAGAMENTO"].includes(
    status,
  );
}

export function isContractExpired(expiryDate: Date | null | undefined): boolean {
  if (!expiryDate) return false;
  return new Date(expiryDate) < new Date();
}
