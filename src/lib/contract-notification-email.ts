import "server-only";
import { clientDisplayName, formatDate } from "@/lib/utils";
import { formatRomeDateTime } from "@/lib/timezone";
import { operationTypeLabel } from "@/lib/provvigioni-stato";

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

export type ContractLike = {
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

function anagraficaBlock(contract: ContractLike): string[] {
  const residence = formatAddr({
    street: contract.client.street,
    streetNumber: contract.client.streetNumber,
    zipCode: contract.client.zipCode,
    city: contract.client.city,
    province: contract.client.province,
    region: contract.client.region,
    fallback: contract.client.address,
  });
  return [
    "========== BLOCCO ANAGRAFICA CLIENTE ==========",
    line("Cliente", clientDisplayName(contract.client)),
    line("Tipo cliente", contract.client.type === "AZIENDA" ? "Business" : "Privato / Domestico"),
    line("Classificazione (Residente / Non residente / …)", contract.client.classification),
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
  ];
}

function serviceBlock(contract: ContractLike, index: number, total: number): string[] {
  const supply = formatAddr({
    street: contract.supplyStreet ?? contract.client.supplyStreet,
    streetNumber: contract.supplyStreetNumber ?? contract.client.supplyStreetNumber,
    zipCode: contract.supplyZipCode ?? contract.client.supplyZipCode,
    city: contract.supplyCity ?? contract.client.supplyCity,
    province: contract.supplyProvince ?? contract.client.supplyProvince,
    region: contract.supplyRegion ?? contract.client.supplyRegion,
    fallback: contract.supplyAddress ?? contract.client.supplyAddress,
  });
  const utility = (contract.utilityType || `SERVIZIO ${index + 1}`).toUpperCase();
  const title =
    total > 1
      ? `========== BLOCCO ${utility} (${index + 1}/${total}) – ${contract.contractNumber} ==========`
      : "========== BLOCCO FORNITORE / CONTRATTO ==========";

  return [
    "",
    title,
    line("Numero pratica", contract.contractNumber),
    line("Stato", contract.status),
    line("Tipologia contratto (Domestico / Non domestico)", contract.contractKind),
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
  ];
}

function priceTypeLabel(raw: string | null | undefined): string {
  const v = (raw ?? "").trim().toUpperCase();
  if (!v) return "";
  if (v.includes("FISSO") || v === "FIXED" || v === "FIX") return "Fisso";
  if (v.includes("VARIAB") || v === "INDEX" || v.includes("INDICIZZ")) return "Variabile";
  if (v.includes("MISTO")) return "Misto";
  // Mantieni il testo originale capitalizzato se già leggibile
  return raw!.trim();
}

/** Oggetto email lavorazione: Cliente – Servizio – Operazione – Fisso/Variabile (senza n. pratica). */
function buildLavorazioneSubject(
  contract: ContractLike,
  opts?: { resend?: boolean },
): string {
  const clientName = clientDisplayName(contract.client);
  const utility = (contract.utilityType || "").trim().toUpperCase();
  const operation =
    contract.operationType?.toUpperCase() === "ALTRO" && contract.operationOther
      ? contract.operationOther.trim()
      : operationTypeLabel(contract.operationType);
  const price = priceTypeLabel(contract.priceType);

  const parts = [
    opts?.resend ? "REINVIO – Nuovo contratto da lavorare" : "Nuovo contratto da lavorare",
    clientName,
    utility || null,
    operation || null,
    price || null,
  ].filter((p) => p && String(p).trim());

  return parts.join(" – ");
}

function attachmentsBlock(
  contracts: ContractLike[],
  appUrl: string,
): { lines: string[]; docsWithContent: ContractLike["documents"] } {
  // Preferisci i documenti del contratto che ne ha di più (con contenuto)
  const richest = [...contracts].sort(
    (a, b) =>
      b.documents.filter((d) => d.contentBase64).length -
      a.documents.filter((d) => d.contentBase64).length,
  )[0]!;
  const docs = richest.documents;
  const links = docs.map(
    (d) =>
      `- ${d.filename} (${d.docType || "file"}, ${Math.round(d.size / 1024)}KB)${
        d.contentBase64 ? "" : " [solo metadati / link]"
      }: ${appUrl}/api/documents/${d.id}`,
  );
  const schede = contracts.map(
    (c) => `- ${c.utilityType || "contratto"} ${c.contractNumber}: ${appUrl}/lavorazione/${c.id}`,
  );
  return {
    lines: [
      "",
      "========== ALLEGATI ==========",
      ...(links.length ? links : ["- Nessun allegato caricato"]),
      "",
      "Schede lavorazione CRM:",
      ...schede,
      "",
      "Nota: i file sotto soglia SMTP partono anche come allegati; i file grandi restano scaricabili dai link (accesso autenticato).",
    ],
    docsWithContent: docs.filter((d) => d.contentBase64),
  };
}

/** Corpo email completo per un singolo contratto. */
export function buildContractNotificationBody(
  contract: ContractLike,
  opts?: { appUrl?: string; resendReason?: string; resentBy?: string },
): { subject: string; body: string } {
  const appUrl =
    opts?.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://crm.fmconsulenza.it";
  const isResend = Boolean(opts?.resendReason);
  const subject = buildLavorazioneSubject(contract, { resend: isResend });

  const att = attachmentsBlock([contract], appUrl);
  const body = [
    isResend
      ? `REINVIO richiesto da ${opts?.resentBy || "admin"}`
      : "Il contratto è nella coda «In lavorazione» (invio al BACK OFFICE).",
    ...(opts?.resendReason ? [line("Motivo reinvio", opts.resendReason)] : []),
    "",
    "========== INTESTAZIONE ==========",
    line("Numero pratica", contract.contractNumber),
    line("Data invio", formatRomeDateTime(new Date())),
    line("Collaboratore", contract.collaborator.name),
    "",
    ...anagraficaBlock(contract),
    ...serviceBlock(contract, 0, 1),
    ...att.lines,
  ].join("\n");

  return { subject, body };
}

/**
 * Una sola email per più contratti creati insieme (es. Luce + Gas):
 * anagrafica condivisa + blocco per ogni servizio + allegati una volta.
 */
export function buildBatchContractNotificationBody(
  contracts: ContractLike[],
  opts?: { appUrl?: string },
): { subject: string; body: string; docsWithContent: ContractLike["documents"] } {
  if (contracts.length === 0) {
    return { subject: "Nuovi contratti", body: "Nessun contratto", docsWithContent: [] };
  }
  if (contracts.length === 1) {
    const single = buildContractNotificationBody(contracts[0]!, opts);
    const att = attachmentsBlock(contracts, opts?.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://crm.fmconsulenza.it");
    return { ...single, docsWithContent: att.docsWithContent };
  }

  const appUrl =
    opts?.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://crm.fmconsulenza.it";
  const first = contracts[0]!;
  const clientName = clientDisplayName(first.client);
  const utilities = contracts
    .map((c) => (c.utilityType || "").trim().toUpperCase() || "?")
    .join("+");
  const operations = [
    ...new Set(
      contracts.map((c) =>
        c.operationType?.toUpperCase() === "ALTRO" && c.operationOther
          ? c.operationOther.trim()
          : operationTypeLabel(c.operationType),
      ),
    ),
  ].join("/");
  const prices = [
    ...new Set(
      contracts.map((c) => priceTypeLabel(c.priceType)).filter(Boolean),
    ),
  ].join("/");
  const numbers = contracts.map((c) => c.contractNumber).join(", ");

  const subject = [
    `Nuovi contratti da lavorare (${contracts.length})`,
    clientName,
    utilities,
    operations || null,
    prices || null,
  ]
    .filter((p) => p && String(p).trim())
    .join(" – ");
  const att = attachmentsBlock(contracts, appUrl);

  const body = [
    `Sono stati creati ${contracts.length} contratti insieme e sono in coda «In lavorazione» (BACK OFFICE).`,
    line("Data invio", formatRomeDateTime(new Date())),
    line("Collaboratore", first.collaborator.name),
    line("Pratiche", numbers),
    line("Servizi", utilities),
    "",
    ...anagraficaBlock(first),
    ...contracts.flatMap((c, i) => serviceBlock(c, i, contracts.length)),
    ...att.lines,
  ].join("\n");

  return { subject, body, docsWithContent: att.docsWithContent };
}
