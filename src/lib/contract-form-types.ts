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

export type ContractServiceLine = {
  id: string;
  service: string;
  serviceOther?: string;
  pod?: string;
  pdr?: string;
  powerKw?: string;
  annualKwh?: string;
  annualSmc?: string;
  phoneNumber?: string;
  migrationCode?: string;
  techNotes?: string;
};

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
  supplierId?: string;
  supplierName?: string;
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
  durationMonths: number;
  productName?: string;
  offerCode?: string;
  contractKind?: string;
  priceType?: string;
  paymentMethod?: string;
  ibanHolder?: string;
  ibanHolderCf?: string;
  invoiceEmail?: string;
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
