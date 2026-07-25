/**
 * Backup Excel completo del CRM: tutti i dati registrati, divisi per categoria
 * (fogli rinominati e catalogati in italiano).
 */
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { clientDisplayName } from "@/lib/utils";
import { formatRomeDateTime, romeDayBounds } from "@/lib/timezone";
import { CONTRACT_STATUS_LABELS } from "@/lib/constants";
import { formatInTimeZone } from "date-fns-tz";
import { APP_TZ } from "@/lib/timezone";

type Cell = string | number | boolean | null;

function cell(v: unknown): Cell {
  if (v == null) return null;
  if (typeof v === "boolean" || typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return formatRomeDateTime(v);
  if (typeof v === "object" && v !== null && "toNumber" in v) {
    try {
      return (v as { toNumber: () => number }).toNumber();
    } catch {
      return String(v);
    }
  }
  return String(v);
}

/** Solo data gg/mm/aaaa (Europe/Rome) — per date “giorno”. */
function cellDate(v: Date | string | null | undefined): Cell {
  if (!v) return null;
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return null;
  return formatInTimeZone(d, APP_TZ, "dd/MM/yyyy");
}

function yn(v: boolean | null | undefined): Cell {
  if (v == null) return null;
  return v ? "Sì" : "No";
}

function statusLabel(status: string): string {
  return (
    (CONTRACT_STATUS_LABELS as Record<string, string>)[status] ?? status
  );
}

function isPaid(paymentStatus: string | null | undefined, received: number): string {
  const s = (paymentStatus ?? "").toLowerCase();
  if (s.includes("incass") || s === "paid" || s === "pagato") return "Sì";
  if (received > 0 && s.includes("da incass")) return "Parziale";
  if (received > 0) return "Sì";
  return "No";
}

function addSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  headers: string[],
  rows: Cell[][],
) {
  const sheet = workbook.addWorksheet(name.slice(0, 31));
  sheet.addRow(headers);
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE2E8F0" },
  };
  for (const row of rows) sheet.addRow(row);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };
}

function joinAddr(
  street?: string | null,
  number?: string | null,
  fallback?: string | null,
): string | null {
  const parts = [street, number].filter(Boolean).join(" ").trim();
  return parts || fallback || null;
}

/** Conta contratti creati nella giornata Europe/Rome (non cancellati). */
export async function countNewContractsToday(dateYmd?: string): Promise<{
  count: number;
  reportDate: string;
  start: Date;
  end: Date;
}> {
  const { start, end, reportDate } = romeDayBounds(dateYmd);
  const count = await prisma.contract.count({
    where: {
      deletedAt: null,
      createdAt: { gte: start, lte: end },
    },
  });
  return { count, reportDate, start, end };
}

/**
 * Excel multi-foglio: backup completo di tutto ciò che è registrato nel CRM
 * (senza password utenti e senza contenuto binario allegati).
 */
export async function buildFullDbExcelBuffer(): Promise<{
  buffer: Buffer;
  filename: string;
  counts: Record<string, number>;
}> {
  const [
    contracts,
    clients,
    commissions,
    recurringMonths,
    suppliers,
    services,
    rules,
    users,
    statusHistory,
    documents,
  ] = await Promise.all([
    prisma.contract.findMany({
      where: { deletedAt: null },
      include: {
        client: true,
        collaborator: { select: { name: true, email: true } },
        createdBy: { select: { name: true } },
        supplier: { select: { name: true, code: true } },
        service: { select: { name: true } },
        commissionRule: { select: { name: true } },
        commission: true,
      },
      orderBy: { insertionDate: "desc" },
    }),
    prisma.client.findMany({
      where: { deletedAt: null },
      include: {
        createdBy: { select: { name: true } },
        _count: { select: { contracts: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.commission.findMany({
      include: {
        contract: {
          select: {
            contractNumber: true,
            paymentStatus: true,
            paymentDate: true,
            collectionDate: true,
            commissionConfirmed: true,
            collaborator: { select: { name: true } },
            supplier: { select: { name: true } },
            client: true,
          },
        },
      },
    }),
    prisma.recurringMonth.findMany({
      include: {
        contract: {
          select: {
            contractNumber: true,
            collaborator: { select: { name: true } },
            supplier: { select: { name: true } },
            client: true,
          },
        },
      },
      orderBy: [{ period: "desc" }, { contractId: "asc" }],
    }),
    prisma.supplier.findMany({ orderBy: { name: "asc" } }),
    prisma.service.findMany({
      include: { supplier: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.commissionRule.findMany({
      include: {
        supplier: { select: { name: true } },
        service: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.contractStatusHistory.findMany({
      include: {
        contract: { select: { contractNumber: true } },
        changedBy: { select: { name: true } },
      },
      orderBy: { changedAt: "desc" },
      take: 20000,
    }),
    prisma.document.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        size: true,
        docType: true,
        path: true,
        storageProvider: true,
        uploadedAt: true,
        contentClearedAt: true,
        clientId: true,
        contractId: true,
        contract: { select: { contractNumber: true } },
        client: {
          select: { firstName: true, lastName: true, companyName: true, type: true },
        },
      },
      orderBy: { uploadedAt: "desc" },
    }),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CRM FM Consulenza";
  workbook.created = new Date();
  workbook.description =
    "Backup completo database CRM — fogli per categoria. Conservare in caso di ripristino.";

  const generatedAt = formatRomeDateTime(new Date());

  // ——— INDICE (catalogo) ———
  addSheet(
    workbook,
    "00_Indice",
    ["Foglio", "Categoria", "Righe", "Descrizione"],
    [
      ["00_Indice", "Catalogo", 1, "Elenco fogli di questo backup"],
      [
        "01_Clienti",
        "Anagrafica",
        clients.length,
        "Tutti i clienti (dati anagrafici, contatti, indirizzi, legale)",
      ],
      [
        "02_Contratti",
        "Contratti",
        contracts.length,
        "Tutti i contratti: date, POD/PDR, pagamento, gettoni, indirizzo fornitura",
      ],
      [
        "03_Provvigioni",
        "Economico",
        commissions.length,
        "Gettoni previsti / ricevuti / pagati per contratto",
      ],
      [
        "04_Ricorrenze",
        "Economico",
        recurringMonths.length,
        "Mesi ricorrenti (competenza + mese pagamento)",
      ],
      [
        "05_Fornitori",
        "Listino",
        suppliers.length,
        "Fornitori energia / servizi",
      ],
      [
        "06_Servizi",
        "Listino",
        services.length,
        "Servizi collegati ai fornitori",
      ],
      [
        "07_Listino_regole",
        "Listino",
        rules.length,
        "Regole gettone (base, RID, mensile, ecc.)",
      ],
      [
        "08_Utenti",
        "Sistema",
        users.length,
        "Collaboratori e admin (senza password)",
      ],
      [
        "09_Storico_stati",
        "Contratti",
        statusHistory.length,
        "Cronologia cambi stato contratti",
      ],
      [
        "10_Allegati_elenco",
        "Documenti",
        documents.length,
        "Elenco allegati (solo nomi/metadati, non i file)",
      ],
      ["—", "Generato", "—", generatedAt],
    ],
  );

  // ——— CLIENTI (completi) ———
  addSheet(
    workbook,
    "01_Clienti",
    [
      "ID cliente",
      "Nome visualizzato",
      "Tipo",
      "Ragione sociale",
      "Nome",
      "Cognome",
      "Codice fiscale",
      "Partita IVA",
      "Email",
      "PEC",
      "Telefono",
      "IBAN",
      "Classificazione",
      "Indirizzo (legacy)",
      "Via",
      "Civico",
      "Città",
      "CAP",
      "Provincia",
      "Regione",
      "Nazione",
      "Indirizzo fornitura (legacy)",
      "Via fornitura",
      "Civico fornitura",
      "Città fornitura",
      "CAP fornitura",
      "Provincia fornitura",
      "Regione fornitura",
      "Indirizzi coincidenti",
      "Rapp. legale nome",
      "Rapp. legale cognome",
      "Rapp. legale CF",
      "Codice SDI",
      "Note",
      "N. contratti",
      "Creato da",
      "Data creazione",
      "Ultimo aggiornamento",
    ],
    clients.map((c) => [
      cell(c.id),
      cell(clientDisplayName(c)),
      cell(c.type),
      cell(c.companyName),
      cell(c.firstName),
      cell(c.lastName),
      cell(c.fiscalCode),
      cell(c.vatNumber),
      cell(c.email),
      cell(c.pec),
      cell(c.phone),
      cell(c.iban),
      cell(c.classification),
      cell(c.address),
      cell(c.street),
      cell(c.streetNumber),
      cell(c.city),
      cell(c.zipCode),
      cell(c.province),
      cell(c.region),
      cell(c.country),
      cell(c.supplyAddress),
      cell(c.supplyStreet),
      cell(c.supplyStreetNumber),
      cell(c.supplyCity),
      cell(c.supplyZipCode),
      cell(c.supplyProvince),
      cell(c.supplyRegion),
      yn(c.addressesMatch),
      cell(c.legalFirstName),
      cell(c.legalLastName),
      cell(c.legalFiscalCode),
      cell(c.sdiCode),
      cell(c.notes),
      cell(c._count.contracts),
      cell(c.createdBy.name),
      cellDate(c.createdAt),
      cell(c.updatedAt),
    ]),
  );

  // ——— CONTRATTI (completi + date pagamento) ———
  addSheet(
    workbook,
    "02_Contratti",
    [
      "ID contratto",
      "N. contratto",
      "ID esterno",
      "ID cliente",
      "Cliente",
      "Tipo cliente",
      "CF cliente",
      "P.IVA cliente",
      "Email cliente",
      "Telefono cliente",
      "Collaboratore",
      "Creato da",
      "Fornitore",
      "Codice fornitore",
      "Servizio",
      "Regola listino",
      "Stato",
      "Stato (etichetta)",
      "Utility",
      "Prodotto",
      "Codice offerta",
      "Tipo contratto",
      "POD",
      "PDR",
      "POD/PDR",
      "Tipo prezzo",
      "Potenza kW",
      "kWh annui",
      "Smc annui",
      "Ricorrenza",
      "Metodo pagamento",
      "IBAN contratto",
      "Intestatario IBAN",
      "CF intestatario IBAN",
      "Mandato SEPA",
      "Note pagamento",
      "Via fornitura",
      "Civico fornitura",
      "Città fornitura",
      "CAP fornitura",
      "Provincia fornitura",
      "Regione fornitura",
      "Indirizzo fornitura (testo)",
      "Email fattura",
      "Modalità fattura",
      "Tipo operazione",
      "Agenzia",
      "Etichetta archivio",
      "Storico",
      "Durata mesi",
      // DATE IMPORTANTI
      "Data inserimento",
      "Data sottoscrizione",
      "Data ricevuta",
      "Data ingresso fornitura",
      "Data attivazione",
      "Data pagamento prevista",
      "Data pagamento",
      "Data incasso (gettone)",
      "Data scadenza",
      "Fine storno",
      "Data email lavorazione",
      // PAGAMENTO / GETTONE
      "Pagato (Sì/No)",
      "Stato pagamento",
      "Importo pagamento previsto",
      "Importo pagato",
      "Gettone previsto",
      "Gettone maturato",
      "Gettone ricevuto",
      "Gettone liquidato collab.",
      "Gettone confermato",
      "Data conferma gettone",
      "Inviato a master",
      "Assegnato a master",
      "Stato email",
      "Motivo KO",
      "Note KO",
      "Note interne",
      "Note lavoro",
      "Note master",
      "Note",
      "Creato il",
      "Aggiornato il",
    ],
    contracts.map((c) => {
      const received = Number(c.commission?.received ?? 0);
      return [
        cell(c.id),
        cell(c.contractNumber),
        cell(c.externalId),
        cell(c.clientId),
        cell(clientDisplayName(c.client)),
        cell(c.client.type),
        cell(c.client.fiscalCode),
        cell(c.client.vatNumber),
        cell(c.client.email),
        cell(c.client.phone),
        cell(c.collaborator.name),
        cell(c.createdBy?.name),
        cell(c.supplier.name),
        cell(c.supplier.code),
        cell(c.service?.name),
        cell(c.commissionRule?.name),
        cell(c.status),
        cell(statusLabel(c.status)),
        cell(c.utilityType),
        cell(c.productName),
        cell(c.offerCode),
        cell(c.contractKind),
        cell(c.pod),
        cell(c.pdr),
        cell(c.podPdr),
        cell(c.priceType),
        cell(c.powerKw),
        cell(c.annualKwh),
        cell(c.annualSmc),
        cell(c.recurrence),
        cell(c.paymentMethod),
        cell(c.contractIban),
        cell(c.ibanHolder),
        cell(c.ibanHolderCf),
        cell(c.sepaMandate),
        cell(c.paymentNotes),
        cell(c.supplyStreet),
        cell(c.supplyStreetNumber),
        cell(c.supplyCity),
        cell(c.supplyZipCode),
        cell(c.supplyProvince),
        cell(c.supplyRegion),
        cell(
          joinAddr(c.supplyStreet, c.supplyStreetNumber, c.supplyAddress),
        ),
        cell(c.invoiceEmail),
        cell(c.invoiceMode),
        cell(c.operationType),
        cell(c.agency),
        cell(c.archiveLabel),
        yn(c.isHistorical),
        cell(c.durationMonths),
        // DATE
        cellDate(c.insertionDate),
        cellDate(c.subscriptionDate),
        cellDate(c.receivedDate),
        cellDate(c.supplyStartDate),
        cellDate(c.activationDate),
        cellDate(c.expectedPaymentDate),
        cellDate(c.paymentDate),
        cellDate(c.collectionDate),
        cellDate(c.expiryDate),
        cellDate(c.stornoEndDate),
        cellDate(c.workEmailDate),
        // PAGAMENTO
        cell(isPaid(c.paymentStatus, received)),
        cell(c.paymentStatus),
        cell(c.expectedPaymentAmount),
        cell(c.paymentAmount),
        cell(c.commission?.expected),
        cell(c.commission?.accrued),
        cell(c.commission?.received),
        cell(c.commission?.paid),
        yn(c.commissionConfirmed),
        cellDate(c.commissionConfirmedAt),
        yn(c.sendToMaster),
        yn(c.assignedToMaster),
        cell(c.emailStatus),
        cell(c.koReason),
        cell(c.koNotes),
        cell(c.internalNotes),
        cell(c.workNotes),
        cell(c.masterNotes),
        cell(c.notes),
        cell(c.createdAt),
        cell(c.updatedAt),
      ];
    }),
  );

  // ——— PROVVIGIONI ———
  addSheet(
    workbook,
    "03_Provvigioni",
    [
      "ID provvigione",
      "N. contratto",
      "Cliente",
      "Collaboratore",
      "Fornitore",
      "Gettone previsto",
      "Gettone maturato",
      "Gettone ricevuto",
      "Gettone liquidato",
      "Pagato (contratto)",
      "Stato pagamento",
      "Data pagamento",
      "Data incasso",
      "Gettone confermato",
      "ID contratto",
    ],
    commissions.map((p) => {
      const received = Number(p.received);
      return [
        cell(p.id),
        cell(p.contract.contractNumber),
        cell(clientDisplayName(p.contract.client)),
        cell(p.contract.collaborator.name),
        cell(p.contract.supplier.name),
        cell(p.expected),
        cell(p.accrued),
        cell(p.received),
        cell(p.paid),
        cell(isPaid(p.contract.paymentStatus, received)),
        cell(p.contract.paymentStatus),
        cellDate(p.contract.paymentDate),
        cellDate(p.contract.collectionDate),
        yn(p.contract.commissionConfirmed),
        cell(p.contractId),
      ];
    }),
  );

  // ——— RICORRENZE ———
  addSheet(
    workbook,
    "04_Ricorrenze",
    [
      "ID",
      "N. contratto",
      "Cliente",
      "Collaboratore",
      "Fornitore",
      "Mese competenza (YYYY-MM)",
      "Mese pagamento / bonifico",
      "Stato",
      "Importo",
      "Pagato il",
      "Note",
    ],
    recurringMonths.map((r) => [
      cell(r.id),
      cell(r.contract.contractNumber),
      cell(clientDisplayName(r.contract.client)),
      cell(r.contract.collaborator.name),
      cell(r.contract.supplier.name),
      cell(r.period),
      cell(r.settledPeriod),
      cell(r.status),
      cell(r.amount),
      cellDate(r.paidAt),
      cell(r.note),
    ]),
  );

  // ——— FORNITORI ———
  addSheet(
    workbook,
    "05_Fornitori",
    [
      "ID",
      "Nome",
      "Codice",
      "Attivo",
      "Email",
      "Mesi storno",
      "Note",
      "Creato",
      "Aggiornato",
    ],
    suppliers.map((s) => [
      cell(s.id),
      cell(s.name),
      cell(s.code),
      yn(s.active),
      cell(s.email),
      cell(s.stornoMonths),
      cell(s.notes),
      cellDate(s.createdAt),
      cell(s.updatedAt),
    ]),
  );

  // ——— SERVIZI ———
  addSheet(
    workbook,
    "06_Servizi",
    ["ID", "Nome", "Fornitore", "Attivo", "Creato"],
    services.map((s) => [
      cell(s.id),
      cell(s.name),
      cell(s.supplier.name),
      yn(s.active),
      cellDate(s.createdAt),
    ]),
  );

  // ——— LISTINO ———
  addSheet(
    workbook,
    "07_Listino_regole",
    [
      "ID",
      "Fornitore",
      "Servizio",
      "Nome regola",
      "Tipo pagamento",
      "Importo fisso",
      "Percentuale",
      "Rate",
      "Segmento cliente",
      "Mesi storno regola",
      "Gettone base",
      "Gettone RID",
      "Gettone bolletta web",
      "Gettone mail",
      "Gettone mensile",
      "Gettone una tantum iniziale",
      "Note",
      "Valido da",
      "Valido a",
      "Attivo",
    ],
    rules.map((r) => [
      cell(r.id),
      cell(r.supplier.name),
      cell(r.service?.name),
      cell(r.name),
      cell(r.paymentType),
      cell(r.fixedAmount),
      cell(r.percentage),
      cell(r.installments),
      cell(r.clientSegment),
      cell(r.stornoMonths),
      cell(r.gettoneBase),
      cell(r.gettoneRid),
      cell(r.gettoneBollettaWeb),
      cell(r.gettoneMail),
      cell(r.gettoneMensile),
      cell(r.gettoneUnaTantumIniziale),
      cell(r.notes),
      cellDate(r.validFrom),
      cellDate(r.validTo),
      yn(r.active),
    ]),
  );

  // ——— UTENTI ———
  addSheet(
    workbook,
    "08_Utenti",
    ["ID", "Nome", "Email", "Ruolo", "Attivo", "Creato", "Aggiornato"],
    users.map((u) => [
      cell(u.id),
      cell(u.name),
      cell(u.email),
      cell(u.role),
      yn(u.active),
      cellDate(u.createdAt),
      cell(u.updatedAt),
    ]),
  );

  // ——— STORICO STATI ———
  addSheet(
    workbook,
    "09_Storico_stati",
    [
      "ID",
      "N. contratto",
      "Da stato",
      "A stato",
      "A stato (etichetta)",
      "Modificato da",
      "Quando",
      "Nota",
      "Motivo KO",
      "Importo atteso",
      "Data attivazione",
    ],
    statusHistory.map((h) => [
      cell(h.id),
      cell(h.contract.contractNumber),
      cell(h.fromStatus),
      cell(h.toStatus),
      cell(statusLabel(h.toStatus)),
      cell(h.changedBy.name),
      cell(h.changedAt),
      cell(h.note),
      cell(h.koReason),
      cell(h.expectedPaymentAmount),
      cellDate(h.activationDate),
    ]),
  );

  // ——— ALLEGATI (metadati) ———
  addSheet(
    workbook,
    "10_Allegati_elenco",
    [
      "ID",
      "Nome file",
      "Tipo documento",
      "MIME",
      "Dimensione (byte)",
      "N. contratto",
      "Cliente",
      "Caricato il",
      "Contenuto svuotato",
      "Percorso logico",
    ],
    documents.map((d) => [
      cell(d.id),
      cell(d.filename),
      cell(d.docType),
      cell(d.mimeType),
      cell(d.size),
      cell(d.contract?.contractNumber),
      d.client ? cell(clientDisplayName(d.client)) : null,
      cell(d.uploadedAt),
      cellDate(d.contentClearedAt),
      cell(d.path),
    ]),
  );

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `crm-backup-completo-${stamp}.xlsx`;
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return {
    buffer,
    filename,
    counts: {
      clients: clients.length,
      contracts: contracts.length,
      commissions: commissions.length,
      recurringMonths: recurringMonths.length,
      suppliers: suppliers.length,
      services: services.length,
      rules: rules.length,
      users: users.length,
      statusHistory: statusHistory.length,
      documents: documents.length,
    },
  };
}
