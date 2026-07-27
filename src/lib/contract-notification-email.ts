import "server-only";
import { clientDisplayName, formatDate } from "@/lib/utils";
import { formatRomeDateTime } from "@/lib/timezone";

type ClientLike = {
  type: string;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fiscalCode?: string | null;
  vatNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  pec?: string | null;
  iban?: string | null;
  street?: string | null;
  streetNumber?: string | null;
  zipCode?: string | null;
  city?: string | null;
  province?: string | null;
  region?: string | null;
  address?: string | null;
  classification?: string | null;
  legalFirstName?: string | null;
  legalLastName?: string | null;
  legalFiscalCode?: string | null;
  sdiCode?: string | null;
  supplyStreet?: string | null;
  supplyStreetNumber?: string | null;
  supplyZipCode?: string | null;
  supplyCity?: string | null;
  supplyProvince?: string | null;
  supplyRegion?: string | null;
  supplyAddress?: string | null;
};

type ContractLike = {
  id: string;
  contractNumber: string;
  utilityType?: string | null;
  productName?: string | null;
  offerCode?: string | null;
  contractKind?: string | null;
  operationType?: string | null;
  operationOther?: string | null;
  serviceOther?: string | null;
  pod?: string | null;
  pdr?: string | null;
  podPdr?: string | null;
  priceType?: string | null;
  pricePerKwh?: unknown;
  pricePerSmc?: unknown;
  pcv?: unknown;
  spread?: unknown;
  monthlyFee?: unknown;
  oneOffFee?: unknown;
  discount?: unknown;
  powerKw?: unknown;
  annualKwh?: unknown;
  annualSmc?: unknown;
  paymentMethod?: string | null;
  contractIban?: string | null;
  ibanHolder?: string | null;
  ibanHolderCf?: string | null;
  invoiceEmail?: string | null;
  durationMonths?: number | null;
  insertionDate?: Date | null;
  supplyStartDate?: Date | null;
  activationDate?: Date | null;
  expiryDate?: Date | null;
  supplyStreet?: string | null;
  supplyStreetNumber?: string | null;
  supplyZipCode?: string | null;
  supplyCity?: string | null;
  supplyProvince?: string | null;
  supplyRegion?: string | null;
  supplyAddress?: string | null;
  supplyCountry?: string | null;
  addressesMatch?: boolean | null;
  voltageLevel?: string | null;
  supplyClassification?: string | null;
  masterNotes?: string | null;
  notes?: string | null;
  internalNotes?: string | null;
  economicNotes?: string | null;
  paymentNotes?: string | null;
  status?: string | null;
  client: ClientLike;
  supplier: { name: string; email?: string | null };
  collaborator: { name: string };
  documents: Array<{
    id: string;
    filename: string;
    docType?: string | null;
    size: number;
    contentBase64?: string | null;
  }>;
};

function line(label: string, value: unknown): string {
  const v =
    value === null || value === undefined || value === ""
      ? "—"
      : String(value);
  return `${label}: ${v}`;
}

function formatAddr(parts: {
  street?: string | null;
  streetNumber?: string | null;
  zipCode?: string | null;
  city?: string | null;
  province?: string | null;
  region?: string | null;
  fallback?: string | null;
}): string {
  const main = [parts.street, parts.streetNumber].filter(Boolean).join(" ");
  const cityLine = [
    parts.zipCode,
    parts.city,
    parts.province ? `(${parts.province})` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return [main || parts.fallback, cityLine, parts.region].filter(Boolean).join(" · ") || "—";
}

/** Corpo email completo: anagrafica + fornitura + contratto + pagamento + note + allegati. */
export function buildContractNotificationBody(
  contract: ContractLike,
  opts?: { appUrl?: string; resendReason?: string; resentBy?: string },
): { subject: string; body: string } {
  const appUrl =
    opts?.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://crm.fmconsulenza.it";
  const clientName = clientDisplayName(contract.client);
  const isResend = Boolean(opts?.resendReason);

  const subject = isResend
    ? `REINVIO – Nuovo contratto – ${contract.contractNumber} – ${clientName} – ${contract.utilityType || ""}`
    : `Nuovo contratto da lavorare – ${contract.contractNumber} – ${clientName} – ${contract.utilityType || ""}`;

  const residence = formatAddr({
    street: contract.client.street,
    streetNumber: contract.client.streetNumber,
    zipCode: contract.client.zipCode,
    city: contract.client.city,
    province: contract.client.province,
    region: contract.client.region,
    fallback: contract.client.address,
  });

  const supply = formatAddr({
    street: contract.supplyStreet ?? contract.client.supplyStreet,
    streetNumber: contract.supplyStreetNumber ?? contract.client.supplyStreetNumber,
    zipCode: contract.supplyZipCode ?? contract.client.supplyZipCode,
    city: contract.supplyCity ?? contract.client.supplyCity,
    province: contract.supplyProvince ?? contract.client.supplyProvince,
    region: contract.supplyRegion ?? contract.client.supplyRegion,
    fallback: contract.supplyAddress ?? contract.client.supplyAddress,
  });

  const docLinks = contract.documents.map(
    (d) =>
      `- ${d.filename} (${d.docType || "file"}, ${Math.round(d.size / 1024)}KB)${
        d.contentBase64 ? "" : " [solo metadati / link]"
      }: ${appUrl}/api/documents/${d.id}`,
  );

  const body = [
    isResend
      ? `REINVIO richiesto da ${opts?.resentBy || "admin"}`
      : "Il contratto è nella coda «In lavorazione» (invio al BACK OFFICE).",
    ...(opts?.resendReason ? [line("Motivo reinvio", opts.resendReason)] : []),
    "",
    "========== INTESTAZIONE ==========",
    line("Numero pratica", contract.contractNumber),
    line("Data invio", formatRomeDateTime(new Date())),
    line("Stato", contract.status),
    line("Collaboratore", contract.collaborator.name),
    "",
    "========== BLOCCO ANAGRAFICA CLIENTE ==========",
    line("Cliente", clientName),
    line("Tipo cliente", contract.client.type === "AZIENDA" ? "Business" : "Privato / Domestico"),
    line("Classificazione (Residente / Non residente / …)", contract.client.classification),
    line("Tipologia contratto (Domestico / Non domestico)", contract.contractKind),
    line("Codice fiscale", contract.client.fiscalCode),
    line("Partita IVA", contract.client.vatNumber),
    line("Telefono", contract.client.phone),
    line("Email cliente", contract.client.email),
    line("PEC", contract.client.pec),
    line("IBAN anagrafica", contract.client.iban),
    line(
      "Rappresentante legale",
      [contract.client.legalFirstName, contract.client.legalLastName].filter(Boolean).join(" ") ||
        null,
    ),
    line("CF legale", contract.client.legalFiscalCode),
    line("Codice SDI", contract.client.sdiCode),
    "",
    "— Indirizzo residenza / sede —",
    line("Indirizzo (via e civico)", residence),
    line("CAP", contract.client.zipCode),
    line("Comune", contract.client.city),
    line("Provincia", contract.client.province),
    line("Regione", contract.client.region),
    "",
    "— Indirizzo di fornitura —",
    line(
      "Coincide con residenza",
      contract.addressesMatch == null ? null : contract.addressesMatch ? "Sì" : "No",
    ),
    line("Indirizzo fornitura (via e civico)", supply),
    line("CAP fornitura", contract.supplyZipCode ?? contract.client.supplyZipCode),
    line("Comune fornitura", contract.supplyCity ?? contract.client.supplyCity),
    line("Provincia fornitura", contract.supplyProvince ?? contract.client.supplyProvince),
    line("Regione fornitura", contract.supplyRegion ?? contract.client.supplyRegion),
    line("Nazione", contract.supplyCountry),
    line("Classificazione fornitura", contract.supplyClassification),
    line("Tensione", contract.voltageLevel),
    "",
    "========== BLOCCO FORNITORE / CONTRATTO ==========",
    line("Fornitore", contract.supplier.name),
    line("Servizio / utility", contract.utilityType),
    line("Prodotto / offerta", contract.productName),
    line("Codice offerta", contract.offerCode),
    line("Operazione", contract.operationType),
    line("Altro operazione", contract.operationOther),
    line("Altro servizio", contract.serviceOther),
    line("POD", contract.pod || (contract.utilityType === "LUCE" ? contract.podPdr : null)),
    line("PDR", contract.pdr || (contract.utilityType === "GAS" ? contract.podPdr : null)),
    line("Tipo prezzo", contract.priceType),
    line("Prezzo €/kWh", contract.pricePerKwh),
    line("Prezzo €/Smc", contract.pricePerSmc),
    line("PCV", contract.pcv),
    line("Spread", contract.spread),
    line("Canone mensile", contract.monthlyFee),
    line("Costo una tantum", contract.oneOffFee),
    line("Sconto", contract.discount),
    line("Potenza kW", contract.powerKw),
    line("Consumo annuo kWh", contract.annualKwh),
    line("Consumo annuo Smc", contract.annualSmc),
    line("Durata mesi", contract.durationMonths),
    line("Data inserimento", formatDate(contract.insertionDate)),
    line("Data inizio fornitura", formatDate(contract.supplyStartDate)),
    line("Data attivazione", formatDate(contract.activationDate)),
    line("Scadenza", formatDate(contract.expiryDate)),
    "",
    "— Pagamento —",
    line("Metodo di pagamento", contract.paymentMethod),
    line("IBAN contratto", contract.contractIban),
    line("Intestatario IBAN", contract.ibanHolder),
    line("CF intestatario IBAN", contract.ibanHolderCf),
    line("Email fatturazione", contract.invoiceEmail),
    line("Note pagamento", contract.paymentNotes),
    "",
    "— Note —",
    line("Note Master / back office", contract.masterNotes),
    line("Note contratto", contract.notes),
    line("Note economiche", contract.economicNotes),
    line("Note interne", contract.internalNotes),
    "",
    "========== ALLEGATI ==========",
    ...(docLinks.length ? docLinks : ["- Nessun allegato caricato"]),
    "",
    `Scheda lavorazione CRM: ${appUrl}/lavorazione/${contract.id}`,
    "",
    "Nota: i file sotto soglia SMTP partono anche come allegati; i file grandi restano scaricabili dai link (accesso autenticato).",
  ].join("\n");

  return { subject, body };
}
