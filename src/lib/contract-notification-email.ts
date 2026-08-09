import "server-only";
import { clientDisplayName } from "@/lib/utils";
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
    mimeType?: string | null;
    docType?: string | null;
    size: number;
    contentBase64?: string | null;
  }>;
};

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") {
    const t = value.trim();
    return t === "" || t === "—";
  }
  return false;
}

/** Riga etichetta: valore; se vuoto non viene inviata. */
function line(label: string, value: unknown): string | null {
  if (isEmptyValue(value)) return null;
  return `${label}: ${String(value)}`;
}

/** Tiene solo righe valorizzate; sezioni senza dati vengono omesse. */
function compactLines(...parts: Array<string | null | undefined>): string[] {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0);
}

function formatAddr(parts: {
  street?: string | null;
  streetNumber?: string | null;
  zipCode?: string | null;
  city?: string | null;
  province?: string | null;
  region?: string | null;
  fallback?: string | null;
}): string | null {
  const main = [parts.street, parts.streetNumber].filter(Boolean).join(" ");
  const cityLine = [
    parts.zipCode,
    parts.city,
    parts.province ? `(${parts.province})` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const out = [main || parts.fallback, cityLine, parts.region]
    .filter(Boolean)
    .join(" · ");
  return out || null;
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
  return compactLines(
    clientDisplayName(contract.client).toUpperCase(),
    "",
    contract.client.type === "AZIENDA" ? "INDIRIZZO SEDE LEGALE" : "INDIRIZZO RESIDENZA",
    residence,
  );
}

function clientDataBlock(contract: ContractLike): string[] {
  const business = contract.client.type === "AZIENDA";
  return compactLines(
    "",
    "DATI CLIENTE",
    line("Codice fiscale", contract.client.fiscalCode),
    line("Email", contract.client.email),
    line("Telefono", contract.client.phone),
    business ? line("Partita IVA", contract.client.vatNumber) : null,
    business ? line("PEC", contract.client.pec) : null,
  );
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
  const identifier = contract.pod || contract.pdr || contract.podPdr;
  const identifierLabel = contract.pdr || contract.utilityType === "GAS" ? "PDR" : "POD";
  const iban = contract.contractIban || contract.client.iban;

  return compactLines(
    "",
    total > 1 ? `${utility} (${index + 1}/${total})` : utility,
    "INDIRIZZO FORNITURA",
    supply,
    "",
    identifierLabel,
    identifier,
    "",
    "METODO DI PAGAMENTO",
    contract.paymentMethod,
    iban ? "IBAN" : null,
    iban,
  );
}

function notesBlock(contracts: ContractLike[]): string[] {
  const notes = contracts.flatMap((contract) =>
    [contract.masterNotes, contract.notes].filter(
      (value): value is string => Boolean(value?.trim()),
    ),
  );
  return compactLines("", "NOTE", ...[...new Set(notes)]);
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

function priceFromNotes(contract: ContractLike): string {
  const notes = [contract.masterNotes, contract.notes, contract.economicNotes]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  if (/\b(FISSO|FIXED|FIX)\b/.test(notes)) return "Fisso";
  if (/\b(VARIABILE|INDICIZZATO|INDEX)\b/.test(notes)) return "Variabile";
  return "";
}

/**
 * Etichetta operazione per oggetto email.
 * Usa SOLO il valore indicato sul contratto (Voltura, Switch, …).
 * Non inventa "Switch" se il campo è vuoto.
 */
function operationForSubject(contract: ContractLike): string {
  const raw = (contract.operationType ?? "").trim();
  if (!raw) return "";
  const upper = raw.toUpperCase();
  if (upper === "ALTRO") {
    return (contract.operationOther ?? "").trim() || "Altro";
  }
  // operationTypeLabel senza default forzato: qui raw è già valorizzato
  return operationTypeLabel(raw);
}

/** Oggetto email lavorazione: Cliente – Operazione – Fisso/Variabile. */
function buildLavorazioneSubject(
  contract: ContractLike,
  opts?: { resend?: boolean },
): string {
  const clientName = clientDisplayName(contract.client);
  const operation = operationForSubject(contract);
  const price = priceTypeLabel(contract.priceType) || priceFromNotes(contract);

  const parts = [
    opts?.resend ? "REINVIO" : null,
    clientName,
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
  const body = compactLines(
    isResend
      ? `REINVIO richiesto da ${opts?.resentBy || "admin"}`
      : "Il contratto è nella coda «In lavorazione» (invio al BACK OFFICE).",
    line("Motivo reinvio", opts?.resendReason),
    "",
    ...anagraficaBlock(contract),
    ...serviceBlock(contract, 0, 1),
    ...clientDataBlock(contract),
    ...notesBlock([contract]),
    ...att.lines,
  ).join("\n");

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
  const operations = [
    ...new Set(contracts.map((c) => operationForSubject(c)).filter(Boolean)),
  ].join("/");
  const prices = [
    ...new Set(
      contracts
        .map((c) => priceTypeLabel(c.priceType) || priceFromNotes(c))
        .filter(Boolean),
    ),
  ].join("/");
  const subject = [
    clientName,
    operations || null,
    prices || null,
  ]
    .filter((p) => p && String(p).trim())
    .join(" – ");
  const att = attachmentsBlock(contracts, appUrl);

  const body = compactLines(
    ...anagraficaBlock(first),
    ...contracts.flatMap((c, i) => serviceBlock(c, i, contracts.length)),
    ...clientDataBlock(first),
    ...notesBlock(contracts),
    ...att.lines,
  ).join("\n");

  return { subject, body, docsWithContent: att.docsWithContent };
}
