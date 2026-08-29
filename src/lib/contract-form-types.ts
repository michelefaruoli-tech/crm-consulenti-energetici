import { addMonths } from "date-fns";

export function calcExpiryDate(supplyStart: Date, durationMonths = 12): Date {
  return addMonths(supplyStart, durationMonths);
}

export function isValidIban(iban: string): boolean {
  const cleaned = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^IT\d{2}[A-Z]\d{10}[0-9A-Z]{12}$/.test(cleaned) && cleaned.length < 15) {
    // accettazione soft: lunghezza ragionevole
    return cleaned.length >= 15 && cleaned.length <= 34;
  }
  return cleaned.length >= 15 && cleaned.length <= 34;
}

export type ContractFormAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  docType: string;
  contentBase64: string;
};

/**
 * Un servizio = dati pratica ripetibili (operazione, utenza, fornitore, offerta).
 */
export type ContractServiceLine = {
  id: string;
  // --- 1 Fornitura ---
  supplySameAsResidence?: boolean;
  supplyStreet?: string;
  supplyStreetNumber?: string;
  supplyZipCode?: string;
  supplyCity?: string;
  supplyProvince?: string;
  supplyRegion?: string;
  pod?: string;
  pdr?: string;
  powerKw?: string;
  annualKwh?: string;
  annualSmc?: string;
  migrationCode?: string;
  techNotes?: string;
  phoneNumber?: string;
  // --- 2 Operazione ---
  service: string;
  serviceOther?: string;
  operationType?: string;
  operationOther?: string;
  paymentMethod?: string;
  ibanHolder?: string;
  propertyHolder?: string;
  invoiceMode?: string;
  invoiceEmail?: string;
  // --- 3 Fornitore + condizioni ---
  supplierId?: string;
  /** Nome se si registra un fornitore nuovo su questa riga */
  supplierName?: string;
  commissionRuleId?: string;
  productName?: string;
  offerCode?: string;
  contractKind?: string;
  priceType?: string;
  priceIndex?: string;
  pricePerKwh?: string;
  pricePerSmc?: string;
  pcv?: string;
  spread?: string;
  monthlyFee?: string;
};

export function createEmptyServiceLine(
  partial?: Partial<ContractServiceLine>,
): ContractServiceLine {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10),
    service: "LUCE",
    supplySameAsResidence: true,
    operationType: "SWITCH",
    paymentMethod: "",
    priceType: "FISSO",
    contractKind: "Domestico",
    ...partial,
  };
}

/** Dual luce+gas → due righe distinte (LUCE e GAS) per creare due contratti. */
export function expandDualServiceLines(
  services: ContractServiceLine[],
): ContractServiceLine[] {
  const expanded: ContractServiceLine[] = [];
  for (const line of services) {
    if (line.service === "DUAL") {
      expanded.push({ ...line, id: `${line.id}-luce`, service: "LUCE" });
      expanded.push({ ...line, id: `${line.id}-gas`, service: "GAS" });
    } else {
      expanded.push(line);
    }
  }
  return expanded;
}

export type NewContractPayload = {
  draft: boolean;
  sendToMaster: boolean;
  collaboratorId: string;
  clientId?: string;
  client: {
    type: "PRIVATO" | "AZIENDA";
    firstName?: string;
    lastName?: string;
    companyName?: string;
    fiscalCode?: string;
    vatNumber?: string;
    phone?: string;
    email?: string;
    pec?: string;
    iban?: string;
    street?: string;
    streetNumber?: string;
    zipCode?: string;
    city?: string;
    province?: string;
    region?: string;
    legalFirstName?: string;
    legalLastName?: string;
    legalFiscalCode?: string;
    sdiCode?: string;
    classification?: string;
  };
  /** Fallback se la riga servizio non ha fornitore proprio */
  supplierId?: string;
  supplierName?: string;
  /** Fallback operazione / pagamento / offerta (prima riga) */
  operationType: string;
  operationOther?: string;
  supplySameAsResidence: boolean;
  supplyStreet?: string;
  supplyStreetNumber?: string;
  supplyZipCode?: string;
  supplyCity?: string;
  supplyProvince?: string;
  supplyRegion?: string;
  supplyClassification?: string;
  supplyStartDate?: string;
  /** Data registrazione pratica (GG/MM/AAAA o ISO). Default: oggi. */
  insertionDate?: string;
  durationMonths: number;
  productName?: string;
  offerCode?: string;
  commissionRuleId?: string;
  contractKind?: string;
  priceType?: string;
  paymentMethod?: string;
  ibanHolder?: string;
  ibanHolderCf?: string;
  /** IBAN addebito su questo contratto (default da anagrafica, modificabile). */
  contractIban?: string;
  invoiceEmail?: string;
  invoiceMode?: string;
  pricePerKwh?: string;
  pricePerSmc?: string;
  pcv?: string;
  spread?: string;
  monthlyFee?: string;
  oneOffFee?: string;
  discount?: string;
  economicNotes?: string;
  notes?: string;
  masterNotes?: string;
  services: ContractServiceLine[];
  attachments: ContractFormAttachment[];
  /** Chiave anti-duplicato (generata dal client per richiesta) */
  idempotencyKey?: string;
};
