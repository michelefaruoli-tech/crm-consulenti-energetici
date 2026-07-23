import { format } from "date-fns";
import { it } from "date-fns/locale";

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return format(new Date(date), "dd/MM/yyyy", { locale: it });
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return format(new Date(date), "dd/MM/yyyy HH:mm", { locale: it });
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
  return [client.firstName, client.lastName].filter(Boolean).join(" ") || "Cliente senza nome";
}

export async function generateContractNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `CTR-${year}-`;
  // fallback non-sequenziale se usato fuori da createFull
  const suffix = Math.floor(Math.random() * 900000 + 100000);
  return `${prefix}${suffix}`;
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
