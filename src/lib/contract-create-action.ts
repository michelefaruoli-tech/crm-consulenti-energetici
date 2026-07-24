"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  calcExpiryDate,
  isValidIban,
  type NewContractPayload,
} from "@/lib/contract-form-types";
import { clientDisplayName } from "@/lib/utils";
import { computeSupplyStartDate } from "@/lib/supply-dates";
import { getMasterEmail, sendMail, textToHtmlParagraphs } from "@/lib/mail";
import { formatRomeDateTime } from "@/lib/timezone";

async function nextContractNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `CTR-${year}-`;
  const latest = await prisma.contract.findFirst({
    where: { contractNumber: { startsWith: prefix } },
    orderBy: { contractNumber: "desc" },
    select: { contractNumber: true },
  });
  let seq = 1;
  if (latest?.contractNumber) {
    const part = latest.contractNumber.split("-").pop();
    const n = Number(part);
    if (Number.isFinite(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(6, "0")}`;
}

function num(v?: string): number | null {
  if (!v?.trim()) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function validatePayload(payload: NewContractPayload, sendToMaster: boolean): string[] {
  const errors: string[] = [];
  const c = payload.client;

  // Senza Master: solo anagrafica minima + fornitore + tipologia (privato/business)
  if (c.type === "PRIVATO") {
    if (!c.firstName?.trim()) errors.push("Nome obbligatorio");
    if (!c.lastName?.trim()) errors.push("Cognome obbligatorio");
  } else {
    if (!c.companyName?.trim()) errors.push("Ragione sociale obbligatoria");
  }
  if (!c.type) errors.push("Tipologia cliente (Privato / Business) obbligatoria");
  if (!payload.supplierId && !payload.supplierName?.trim()) {
    errors.push("Fornitore obbligatorio");
  }
  if (!payload.services.length) {
    errors.push("Aggiungi almeno un servizio");
  }

  if (!sendToMaster) {
    return errors;
  }

  // Con Master: validazione completa
  if (c.type === "AZIENDA" && !c.vatNumber?.trim()) {
    errors.push("Partita IVA obbligatoria per invio al Master");
  }
  if (!payload.operationType) errors.push("Tipo operazione obbligatorio");
  if (payload.operationType === "ALTRO" && !payload.operationOther?.trim()) {
    errors.push("Specifica operazione obbligatoria");
  }
  for (const s of payload.services) {
    if (!s.service) errors.push("Servizio obbligatorio su ogni riga");
    if (s.service === "ALTRO" && !s.serviceOther?.trim()) {
      errors.push("Specifica servizio obbligatoria");
    }
    if (s.service === "LUCE" && !s.pod?.trim()) {
      errors.push("POD obbligatorio per Luce");
    }
    if (s.service === "GAS" && !s.pdr?.trim()) {
      errors.push("PDR obbligatorio per Gas");
    }
    if (
      !["LUCE", "GAS"].includes(s.service) &&
      !s.techNotes?.trim() &&
      !s.phoneNumber?.trim()
    ) {
      errors.push(`Identificativo/descrizione tecnica obbligatoria per ${s.service}`);
    }
  }
  if (!c.fiscalCode?.trim()) errors.push("Codice fiscale obbligatorio per invio al Master");
  if (!c.phone?.trim()) errors.push("Telefono obbligatorio per invio al Master");
  if (!c.email?.trim()) errors.push("Email obbligatoria per invio al Master");
  if (!c.zipCode?.trim() || !c.city?.trim()) {
    errors.push("Indirizzo residenza/sede completo obbligatorio");
  }
  if (!payload.contractKind) errors.push("Tipo contratto obbligatorio");
  if (!payload.paymentMethod) errors.push("Metodo di pagamento obbligatorio");
  if (c.type === "AZIENDA") {
    if (!c.legalFirstName?.trim() || !c.legalLastName?.trim()) {
      errors.push("Nome e cognome rappresentante legale obbligatori");
    }
  }
  const classification =
    payload.client.classification || payload.supplyClassification;
  if (!classification?.trim()) {
    errors.push("Classificazione (Residente / Non residente / Altri usi) obbligatoria");
  }
  const hasId = payload.attachments.some((a) =>
    ["CI_FRONTE", "CI_RETRO"].includes(a.docType),
  );
  const hasBill = payload.attachments.some((a) => a.docType === "BOLLETTA");
  if (!hasId) errors.push("Allegato documento di identità obbligatorio");
  if (!hasBill) errors.push("Allegato bolletta/fattura obbligatorio");

  // IBAN obbligatorio solo con Master + RID
  if (payload.paymentMethod === "RID") {
    if (!c.iban?.trim()) errors.push("IBAN obbligatorio per RID");
    else if (!isValidIban(c.iban)) errors.push("IBAN non valido");
  }

  return errors;
}

async function sendMasterEmail(opts: {
  contractId: string;
  contractNumber: string;
  subject: string;
  body: string;
  html?: string;
  attachments: { filename: string; content: Buffer; contentType: string }[];
  sentById: string;
  payloadHash: string;
  emailType?: string;
}): Promise<{ ok: boolean; error?: string; messageId?: string; skipped?: boolean }> {
  const toEmail = getMasterEmail();

  const existing = await prisma.contractEmailLog.findFirst({
    where: {
      contractId: opts.contractId,
      payloadHash: opts.payloadHash,
      status: "SENT",
    },
  });
  if (existing) return { ok: true, messageId: existing.messageId ?? undefined };

  const mail = await sendMail({
    to: toEmail,
    subject: opts.subject,
    text: opts.body,
    html: opts.html ?? textToHtmlParagraphs(opts.body),
    attachments: opts.attachments,
  });

  if (mail.skipped) {
    await prisma.contractEmailLog.create({
      data: {
        contractId: opts.contractId,
        toEmail,
        subject: opts.subject,
        status: "SKIPPED_NO_SMTP",
        emailType: opts.emailType ?? "MASTER_NEW",
        error: mail.error,
        sentById: opts.sentById,
        payloadHash: opts.payloadHash,
      },
    });
    return { ok: false, skipped: true, error: mail.error };
  }

  if (mail.ok) {
    await prisma.contractEmailLog.create({
      data: {
        contractId: opts.contractId,
        toEmail,
        subject: opts.subject,
        status: "SENT",
        emailType: opts.emailType ?? "MASTER_NEW",
        messageId: mail.messageId,
        sentById: opts.sentById,
        payloadHash: opts.payloadHash,
        sentAt: new Date(),
      },
    });
    return { ok: true, messageId: mail.messageId };
  }

  await prisma.contractEmailLog.create({
    data: {
      contractId: opts.contractId,
      toEmail,
      subject: opts.subject,
      status: "ERROR",
      emailType: opts.emailType ?? "MASTER_NEW",
      error: mail.error,
      sentById: opts.sentById,
      payloadHash: opts.payloadHash,
    },
  });
  return { ok: false, error: mail.error };
}

export async function createFullContractAction(
  payload: NewContractPayload,
): Promise<{
  ok: boolean;
  errors?: string[];
  contractIds?: string[];
  message?: string;
  emailError?: string;
}> {
  try {
    return await createFullContractActionInner(payload);
  } catch (e) {
    console.error("[createFullContractAction]", e);
    const msg = e instanceof Error ? e.message : "Errore imprevisto in salvataggio";
    return { ok: false, errors: [msg] };
  }
}

async function createFullContractActionInner(
  payload: NewContractPayload,
): Promise<{
  ok: boolean;
  errors?: string[];
  contractIds?: string[];
  message?: string;
  emailError?: string;
}> {
  const session = await requireSession();
  if (!hasPermission(session.role, "contracts.create")) {
    return { ok: false, errors: ["Permesso negato"] };
  }

  const canPickCollab = hasPermission(session.role, "contracts.edit_all");
  const collaboratorId = canPickCollab
    ? payload.collaboratorId || session.id
    : session.id;

  const sendToMaster = Boolean(payload.sendToMaster) && !payload.draft;
  const errors = validatePayload(payload, sendToMaster);
  if (errors.length) return { ok: false, errors };

  // Cliente
  let clientId = payload.clientId;
  const addressLine = [payload.client.street, payload.client.streetNumber]
    .filter(Boolean)
    .join(" ");
  const classification =
    payload.client.classification || payload.supplyClassification || null;

  if (clientId) {
    await prisma.client.update({
      where: { id: clientId },
      data: {
        type: payload.client.type,
        firstName: payload.client.firstName || null,
        lastName: payload.client.lastName || null,
        companyName: payload.client.companyName || null,
        fiscalCode: payload.client.fiscalCode || null,
        vatNumber: payload.client.vatNumber || null,
        phone: payload.client.phone || null,
        email: payload.client.email || null,
        pec: payload.client.pec || null,
        iban: payload.client.iban || null,
        street: payload.client.street || null,
        streetNumber: payload.client.streetNumber || null,
        address: addressLine || null,
        zipCode: payload.client.zipCode || null,
        city: payload.client.city || null,
        province: payload.client.province || null,
        region: payload.client.region || null,
        legalFirstName: payload.client.legalFirstName || null,
        legalLastName: payload.client.legalLastName || null,
        legalFiscalCode: payload.client.legalFiscalCode || null,
        sdiCode: payload.client.sdiCode || null,
        classification,
        addressesMatch: payload.supplySameAsResidence,
        supplyStreet: payload.supplySameAsResidence
          ? payload.client.street || null
          : payload.supplyStreet || null,
        supplyStreetNumber: payload.supplySameAsResidence
          ? payload.client.streetNumber || null
          : payload.supplyStreetNumber || null,
        supplyZipCode: payload.supplySameAsResidence
          ? payload.client.zipCode || null
          : payload.supplyZipCode || null,
        supplyCity: payload.supplySameAsResidence
          ? payload.client.city || null
          : payload.supplyCity || null,
        supplyProvince: payload.supplySameAsResidence
          ? payload.client.province || null
          : payload.supplyProvince || null,
        supplyRegion: payload.supplySameAsResidence
          ? payload.client.region || null
          : payload.supplyRegion || null,
        supplyAddress: payload.supplySameAsResidence
          ? addressLine || null
          : [payload.supplyStreet, payload.supplyStreetNumber].filter(Boolean).join(" ") ||
            null,
      },
    });
  } else {
    if (!hasPermission(session.role, "clients.create")) {
      return { ok: false, errors: ["Non puoi creare nuovi clienti"] };
    }
    const created = await prisma.client.create({
      data: {
        type: payload.client.type,
        firstName: payload.client.firstName || null,
        lastName: payload.client.lastName || null,
        companyName: payload.client.companyName || null,
        fiscalCode: payload.client.fiscalCode || null,
        vatNumber: payload.client.vatNumber || null,
        phone: payload.client.phone || null,
        email: payload.client.email || null,
        pec: payload.client.pec || null,
        iban: payload.client.iban || null,
        street: payload.client.street || null,
        streetNumber: payload.client.streetNumber || null,
        address: addressLine || null,
        zipCode: payload.client.zipCode || null,
        city: payload.client.city || null,
        province: payload.client.province || null,
        region: payload.client.region || null,
        legalFirstName: payload.client.legalFirstName || null,
        legalLastName: payload.client.legalLastName || null,
        legalFiscalCode: payload.client.legalFiscalCode || null,
        sdiCode: payload.client.sdiCode || null,
        classification,
        createdById: session.id,
        addressesMatch: payload.supplySameAsResidence,
        supplyStreet: payload.supplySameAsResidence
          ? payload.client.street || null
          : payload.supplyStreet || null,
        supplyStreetNumber: payload.supplySameAsResidence
          ? payload.client.streetNumber || null
          : payload.supplyStreetNumber || null,
        supplyZipCode: payload.supplySameAsResidence
          ? payload.client.zipCode || null
          : payload.supplyZipCode || null,
        supplyCity: payload.supplySameAsResidence
          ? payload.client.city || null
          : payload.supplyCity || null,
        supplyProvince: payload.supplySameAsResidence
          ? payload.client.province || null
          : payload.supplyProvince || null,
        supplyRegion: payload.supplySameAsResidence
          ? payload.client.region || null
          : payload.supplyRegion || null,
        supplyAddress: payload.supplySameAsResidence
          ? addressLine || null
          : [payload.supplyStreet, payload.supplyStreetNumber].filter(Boolean).join(" ") ||
            null,
      },
    });
    clientId = created.id;
  }

  // Fornitore
  let supplierId = payload.supplierId;
  if (!supplierId && payload.supplierName?.trim()) {
    const name = payload.supplierName.trim();
    const code =
      name
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .slice(0, 30) || "FORN";
    const existing = await prisma.supplier.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
    });
    if (existing) supplierId = existing.id;
    else {
      const created = await prisma.supplier.create({
        data: { name, code: `${code}_${Date.now().toString(36)}` },
      });
      supplierId = created.id;
    }
  }
  if (!supplierId || !clientId) {
    return { ok: false, errors: ["Cliente o fornitore mancante"] };
  }

  const insertionDate = new Date();
  // Data ingresso calcolata dalla data registrazione + tipo operazione (mai inserita a mano)
  const supplyStart = computeSupplyStartDate(insertionDate, payload.operationType);
  const duration = payload.durationMonths || 12;
  const expiryDate = calcExpiryDate(supplyStart, duration);

  const status = payload.draft
    ? "BOZZA"
    : sendToMaster
      ? "IN_LAVORAZIONE"
      : "INSERITO";
  const masterEmail = sendToMaster ? getMasterEmail() : null;
  const services =
    payload.services.length > 0
      ? payload.services
      : [{ id: "default", service: "LUCE" as const }];
  const idempotencyKey = sendToMaster
    ? createHash("sha256")
        .update(
          JSON.stringify({
            collaboratorId,
            clientId,
            services: services.map((s) => ({
              service: s.service,
              pod: s.pod,
              pdr: s.pdr,
            })),
            minute: Math.floor(Date.now() / 60000),
          }),
        )
        .digest("hex")
    : null;

  const createdIds: string[] = [];
  let firstId = "";

  for (const line of services) {
    const contractNumber = await nextContractNumber();
    const podPdr =
      line.service === "LUCE"
        ? line.pod?.trim() || null
        : line.service === "GAS"
          ? line.pdr?.trim() || null
          : line.pod?.trim() || line.pdr?.trim() || null;

    const created = await prisma.contract.create({
      data: {
        contractNumber,
        clientId,
        supplierId,
        collaboratorId,
        createdById: session.id,
        status,
        utilityType: line.service,
        serviceOther: line.serviceOther || null,
        operationType: payload.operationType || "SWITCH",
        operationOther: payload.operationOther || null,
        productName: payload.productName || null,
        offerCode: payload.offerCode || null,
        contractKind: payload.contractKind || null,
        priceType: payload.priceType || null,
        pod: line.pod?.trim() || null,
        pdr: line.pdr?.trim() || null,
        podPdr,
        powerKw: num(line.powerKw),
        annualKwh: num(line.annualKwh),
        annualSmc: num(line.annualSmc),
        pricePerKwh: num(payload.pricePerKwh),
        pricePerSmc: num(payload.pricePerSmc),
        pcv: num(payload.pcv),
        spread: num(payload.spread),
        monthlyFee: num(payload.monthlyFee),
        oneOffFee: num(payload.oneOffFee),
        discount: num(payload.discount),
        economicNotes: payload.economicNotes || null,
        paymentMethod: payload.paymentMethod || null,
        ibanHolder: payload.ibanHolder || null,
        ibanHolderCf: payload.ibanHolderCf || null,
        invoiceEmail: payload.invoiceEmail || null,
        supplyClassification: classification,
        durationMonths: duration,
        supplyStartDate: supplyStart,
        expiryDate,
        insertionDate,
        sendToMaster,
        assignedToMaster: sendToMaster,
        masterEmail,
        emailIdempotencyKey: idempotencyKey,
        emailStatus: sendToMaster ? "PENDING" : null,
        toWork: sendToMaster,
        notes: payload.notes || null,
        masterNotes: payload.masterNotes || null,
        internalNotes: payload.notes || null,
        technicalJson: JSON.stringify({
          phoneNumber: line.phoneNumber,
          migrationCode: line.migrationCode,
          techNotes: line.techNotes,
        }),
        parentContractId: firstId || null,
      },
    });

    if (!firstId) firstId = created.id;
    createdIds.push(created.id);

    await prisma.contractStatusHistory.create({
      data: {
        contractId: created.id,
        toStatus: status,
        changedById: session.id,
        changeReason: payload.draft
          ? "Salvataggio bozza"
          : sendToMaster
            ? "Invio al Master — stato In lavorazione"
            : "Creazione contratto",
        note: payload.draft
          ? "Salvataggio bozza"
          : sendToMaster
            ? "Creazione + coda Master"
            : "Creazione contratto",
      },
    });

    await prisma.commission.create({
      data: { contractId: created.id, expected: 0 },
    });

    // Allegati solo sul primo contratto (evita payload enorme in multi-servizio)
    if (created.id === firstId) {
      for (const att of payload.attachments) {
        await prisma.document.create({
          data: {
            contractId: created.id,
            clientId,
            filename: att.filename,
            mimeType: att.mimeType,
            size: att.size,
            path: `db://${att.id}`,
            docType: att.docType,
            contentBase64: att.contentBase64,
          },
        });
      }
    }
  }

  let emailError: string | undefined;
  if (sendToMaster && firstId) {
    const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: supplierId } });
    const collab = await prisma.user.findUniqueOrThrow({ where: { id: collaboratorId } });
    const practices = await prisma.contract.findMany({
      where: { id: { in: createdIds } },
      select: {
        contractNumber: true,
        utilityType: true,
        pod: true,
        pdr: true,
        operationType: true,
      },
    });
    const firstNumber = practices[0]?.contractNumber ?? "";
    const subject = `Nuovo contratto da lavorare – ${firstNumber} – ${clientDisplayName(client)} – ${services.map((s) => s.service).join("+")}`;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://crm.fmconsulenza.it";
    const body = [
      "Il contratto è stato inserito nella coda «In lavorazione» del gestionale.",
      "",
      `Numero pratica: ${practices.map((c) => c.contractNumber).join(", ")}`,
      `Data e ora invio: ${formatRomeDateTime(new Date())}`,
      `Collaboratore: ${collab.name}`,
      `Inserito da: ${session.name}`,
      `Cliente: ${clientDisplayName(client)}`,
      `Tipologia: ${client.type === "AZIENDA" ? "Business" : "Privato"}`,
      `Ragione sociale: ${client.companyName || "—"}`,
      `CF: ${client.fiscalCode || "—"}`,
      `P.IVA: ${client.vatNumber || "—"}`,
      `Telefono: ${client.phone || "—"}`,
      `Email: ${client.email || "—"}`,
      `PEC: ${client.pec || "—"}`,
      `Residenza/sede: ${[client.street, client.streetNumber, client.zipCode, client.city, client.province].filter(Boolean).join(" ") || client.address || "—"}`,
      `Fornitura: ${
        client.addressesMatch
          ? "(coincide con residenza/sede)"
          : [client.supplyStreet, client.supplyStreetNumber, client.supplyZipCode, client.supplyCity]
              .filter(Boolean)
              .join(" ") || "—"
      }`,
      `Servizio: ${services.map((s) => s.service).join(", ")}`,
      `Tipo operazione: ${payload.operationType || "—"}`,
      `Fornitore: ${supplier.name}`,
      `POD: ${services.map((s) => s.pod).filter(Boolean).join(", ") || "—"}`,
      `PDR: ${services.map((s) => s.pdr).filter(Boolean).join(", ") || "—"}`,
      `Tipo contratto: ${payload.contractKind || "—"}`,
      `Tipo prezzo: ${payload.priceType || "—"}`,
      `Prezzo energia €/kWh: ${payload.pricePerKwh || "—"}`,
      `Prezzo gas €/Smc: ${payload.pricePerSmc || "—"}`,
      `PCV: ${payload.pcv || "—"}`,
      `Spread: ${payload.spread || "—"}`,
      `Consumi: ${services
        .map((s) => s.annualKwh || s.annualSmc || "")
        .filter(Boolean)
        .join(", ") || "—"}`,
      `Metodo pagamento: ${payload.paymentMethod || "—"}`,
      `IBAN: ${payload.paymentMethod === "RID" ? (payload.client.iban ? "presente (protetto)" : "mancante") : "n/d"}`,
      `Note: ${payload.masterNotes || payload.notes || "—"}`,
      `Allegati: ${payload.attachments.map((a) => a.filename).join(", ") || "nessuno"}`,
      `Link scheda: ${appUrl}/lavorazione/${firstId}`,
      `Link pratica: ${appUrl}/contratti/${firstId}`,
    ].join("\n");

    const hash = idempotencyKey ?? createHash("sha256")
      .update(JSON.stringify({ createdIds, subject, sendToMaster: true }))
      .digest("hex");

    const mailAtts: { filename: string; content: Buffer; contentType: string }[] = [];
    let mailBytes = 0;
    for (const a of payload.attachments.slice(0, 6)) {
      const buf = Buffer.from(a.contentBase64, "base64");
      if (mailBytes + buf.length > 4 * 1024 * 1024) break;
      mailBytes += buf.length;
      mailAtts.push({
        filename: a.filename,
        content: buf,
        contentType: a.mimeType,
      });
    }

    const mail = await sendMasterEmail({
      contractId: firstId,
      contractNumber: firstNumber,
      subject,
      body,
      attachments: mailAtts,
      sentById: session.id,
      payloadHash: hash,
      emailType: "MASTER_NEW",
    });

    const now = new Date();
    if (mail.ok) {
      await prisma.contract.updateMany({
        where: { id: { in: createdIds } },
        data: {
          status: "IN_LAVORAZIONE",
          assignedToMaster: true,
          sendToMaster: true,
          sentToMasterAt: now,
          workEmailDate: now,
          workStatus: "IN_LAVORAZIONE",
          emailStatus: "SENT",
          emailMessageId: mail.messageId ?? null,
          emailAttempts: { increment: 1 },
          emailLastError: null,
          masterEmail: getMasterEmail(),
          emailIdempotencyKey: hash,
        },
      });
    } else {
      emailError = mail.error;
      await prisma.contract.updateMany({
        where: { id: { in: createdIds } },
        data: {
          // Contratto resta in coda lavorazione anche se email fallisce
          status: "IN_LAVORAZIONE",
          assignedToMaster: true,
          sendToMaster: true,
          workStatus: "ERRORE_INVIO",
          emailStatus: mail.skipped ? "SKIPPED_NO_SMTP" : "ERROR",
          emailAttempts: { increment: 1 },
          emailLastError: mail.error ?? "Errore invio",
          masterEmail: getMasterEmail(),
          emailIdempotencyKey: hash,
        },
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: session.id,
      action: "CREATE",
      entity: "Contract",
      entityId: firstId,
      details: JSON.stringify({ createdIds, draft: payload.draft, sendToMaster }),
    },
  });

  revalidatePath("/contratti");
  revalidatePath("/clienti");
  revalidatePath("/provvigioni");
  revalidatePath("/");

  return {
    ok: true,
    contractIds: createdIds,
    message: payload.draft
      ? "Bozza salvata"
      : sendToMaster
        ? "Contratto creato e inviato al Master"
        : `Creat${createdIds.length > 1 ? "i" : "o"} ${createdIds.length} contrat${createdIds.length > 1 ? "ti" : "to"}`,
    emailError,
  };
}
