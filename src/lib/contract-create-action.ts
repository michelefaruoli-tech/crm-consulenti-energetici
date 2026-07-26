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
import { computeSupplyStartDate } from "@/lib/supply-dates";
import { parseFlexibleDate } from "@/lib/date-parse";
import { getMasterEmail } from "@/lib/mail";
import {
  allocateContractNumber,
  syncContractNumberSequenceFromExisting,
} from "@/lib/contract-number";
import { canonicalSupplierName } from "@/lib/supplier-merge";

async function nextContractNumber(): Promise<string> {
  try {
    return await allocateContractNumber();
  } catch (e) {
    // Tabella sequenza assente o non allineata: sync + retry
    console.error("[nextContractNumber] retry after sync", e);
    await syncContractNumberSequenceFromExisting();
    return allocateContractNumber();
  }
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
  if (!payload.services.length) {
    errors.push("Aggiungi almeno un servizio");
  }

  // Fornitore: top-level oppure su ogni riga
  const anySupplier =
    Boolean(payload.supplierId || payload.supplierName?.trim()) ||
    payload.services.some((s) => s.supplierId || s.supplierName?.trim());
  if (!anySupplier) {
    errors.push("Fornitore obbligatorio");
  }

  if (!sendToMaster) {
    return errors;
  }

  // Con Master: validazione completa
  if (c.type === "AZIENDA" && !c.vatNumber?.trim()) {
    errors.push("Partita IVA obbligatoria per invio al Master");
  }
  for (const [i, s] of payload.services.entries()) {
    const n = i + 1;
    const op = s.operationType || payload.operationType;
    if (!op) errors.push(`Servizio #${n}: tipo operazione obbligatorio`);
    if (op === "ALTRO" && !(s.operationOther || payload.operationOther)?.trim()) {
      errors.push(`Servizio #${n}: specifica operazione obbligatoria`);
    }
    if (!s.service) errors.push(`Servizio #${n}: tipologia obbligatoria`);
    if (s.service === "ALTRO" && !s.serviceOther?.trim()) {
      errors.push(`Servizio #${n}: specifica servizio obbligatoria`);
    }
    if (s.service === "LUCE" && !s.pod?.trim()) {
      errors.push(`Servizio #${n}: POD obbligatorio per Luce`);
    }
    if (s.service === "GAS" && !s.pdr?.trim()) {
      errors.push(`Servizio #${n}: PDR obbligatorio per Gas`);
    }
    if (
      !["LUCE", "GAS", "DUAL"].includes(s.service) &&
      !s.techNotes?.trim() &&
      !s.migrationCode?.trim() &&
      !s.phoneNumber?.trim() &&
      !s.pod?.trim() &&
      !s.pdr?.trim()
    ) {
      errors.push(`Servizio #${n}: codice / identificativo tecnico obbligatorio`);
    }
    const pay = s.paymentMethod || payload.paymentMethod;
    if (!pay) errors.push(`Servizio #${n}: metodo di pagamento obbligatorio`);
    if (!(s.supplierId || s.supplierName || payload.supplierId || payload.supplierName)) {
      errors.push(`Servizio #${n}: fornitore obbligatorio`);
    }
  }
  if (!c.fiscalCode?.trim()) errors.push("Codice fiscale obbligatorio per invio al Master");
  if (!c.phone?.trim()) errors.push("Telefono obbligatorio per invio al Master");
  if (!c.email?.trim()) errors.push("Email obbligatoria per invio al Master");
  if (!c.zipCode?.trim() || !c.city?.trim()) {
    errors.push("Indirizzo residenza/sede completo obbligatorio");
  }
  if (!payload.contractKind && !payload.services.some((s) => s.contractKind)) {
    errors.push("Tipo contratto obbligatorio");
  }
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
  // Gli allegati possono essere caricati subito dopo via API (evita body troppo grande).
  // Se non ci sono nell'payload, non blocchiamo qui: il client li invia dopo.
  if (payload.attachments.length > 0) {
    if (!hasId) errors.push("Allegato documento di identità obbligatorio");
    if (!hasBill) errors.push("Allegato bolletta/fattura obbligatorio");
  }

  // IBAN obbligatorio solo con Master + RID (su almeno una riga)
  const usesRid =
    payload.paymentMethod === "RID" ||
    payload.services.some((s) => s.paymentMethod === "RID");
  if (usesRid) {
    if (!c.iban?.trim()) errors.push("IBAN obbligatorio per RID");
    else if (!isValidIban(c.iban)) errors.push("IBAN non valido");
  }

  return errors;
}

export async function createFullContractAction(
  payload: NewContractPayload,
): Promise<{
  ok: boolean;
  errors?: string[];
  contractIds?: string[];
  message?: string;
  emailError?: string;
  emailSent?: boolean;
  code?: string;
}> {
  try {
    return await createFullContractActionInner(payload);
  } catch (e) {
    console.error("[createFullContractAction]", e);
    const raw = e instanceof Error ? e.message : "Errore imprevisto in salvataggio";
    const friendly = raw.includes("Contract_contractNumber_key")
      ? "Non è stato possibile generare il numero del contratto. Riprova."
      : raw.includes("Unique constraint")
        ? "Dato già presente. Riprova o aggiorna la pagina."
        : raw.startsWith("Invalid `prisma")
          ? "Errore di salvataggio. Riprova tra pochi secondi."
          : raw.slice(0, 200);
    return { ok: false, errors: [friendly], code: "CREATE_FAILED" };
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
  emailSent?: boolean;
  code?: string;
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

  if (payload.idempotencyKey?.trim()) {
    const existing = await prisma.createIdempotency.findUnique({
      where: { key: payload.idempotencyKey.trim() },
    });
    if (existing) {
      let ids: string[] = [];
      try {
        ids = JSON.parse(existing.contractIds) as string[];
      } catch {
        ids = [];
      }
      return {
        ok: true,
        contractIds: ids,
        message: "Richiesta già elaborata (nessun duplicato creato)",
        code: "IDEMPOTENT_REPLAY",
        emailSent: false,
      };
    }
  }

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

  async function resolveSupplierId(opts: {
    supplierId?: string;
    supplierName?: string;
  }): Promise<string | null> {
    if (opts.supplierId) return opts.supplierId;
    if (!opts.supplierName?.trim()) return null;
    const name = canonicalSupplierName(opts.supplierName.trim());
    const code =
      name
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .slice(0, 30) || "FORN";
    const existing = await prisma.supplier.findFirst({
      where: {
        active: true,
        OR: [
          { name: { equals: name, mode: "insensitive" } },
          // Match varianti già unificate (Enel Energia → Enel)
          ...(name === "Enel"
            ? [{ name: { startsWith: "Enel", mode: "insensitive" as const } }]
            : name === "Edison"
              ? [{ name: { startsWith: "Edison", mode: "insensitive" as const } }]
              : []),
        ],
      },
      orderBy: { name: "asc" },
    });
    if (existing) {
      if (existing.name !== name) {
        await prisma.supplier.update({
          where: { id: existing.id },
          data: { name },
        });
      }
      return existing.id;
    }
    const created = await prisma.supplier.create({
      data: { name, code: `${code}_${Date.now().toString(36)}` },
    });
    return created.id;
  }

  // Fornitore di fallback (prima riga / payload)
  let defaultSupplierId = await resolveSupplierId({
    supplierId: payload.supplierId,
    supplierName: payload.supplierName,
  });
  if (!defaultSupplierId && payload.services[0]) {
    defaultSupplierId = await resolveSupplierId({
      supplierId: payload.services[0].supplierId,
      supplierName: payload.services[0].supplierName,
    });
  }
  if (!clientId) {
    return { ok: false, errors: ["Cliente mancante"] };
  }
  if (!defaultSupplierId) {
    return { ok: false, errors: ["Fornitore mancante"] };
  }

  const insertionDate =
    parseFlexibleDate(payload.insertionDate ?? "") ?? new Date();
  const duration = payload.durationMonths || 12;

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
    const lineSupplierId =
      (await resolveSupplierId({
        supplierId: line.supplierId,
        supplierName: line.supplierName,
      })) || defaultSupplierId;

    const operationType = line.operationType || payload.operationType || "SWITCH";
    const supplyStart = computeSupplyStartDate(insertionDate, operationType);
    const expiryDate = calcExpiryDate(supplyStart, duration);
    const supplySame =
      line.supplySameAsResidence ?? payload.supplySameAsResidence;
    const supplyStreet = supplySame
      ? payload.client.street || null
      : line.supplyStreet || payload.supplyStreet || null;
    const supplyStreetNumber = supplySame
      ? payload.client.streetNumber || null
      : line.supplyStreetNumber || payload.supplyStreetNumber || null;
    const supplyZipCode = supplySame
      ? payload.client.zipCode || null
      : line.supplyZipCode || payload.supplyZipCode || null;
    const supplyCity = supplySame
      ? payload.client.city || null
      : line.supplyCity || payload.supplyCity || null;
    const supplyProvince = supplySame
      ? payload.client.province || null
      : line.supplyProvince || payload.supplyProvince || null;
    const supplyRegion = supplySame
      ? payload.client.region || null
      : line.supplyRegion || payload.supplyRegion || null;
    const supplyAddress = supplySame
      ? addressLine || null
      : [supplyStreet, supplyStreetNumber].filter(Boolean).join(" ") || null;

    let created: { id: string } | null = null;
    let attempts = 0;
    while (!created && attempts < 5) {
      attempts++;
      try {
        const contractNumber = await nextContractNumber();
        const podPdr =
          line.service === "LUCE"
            ? line.pod?.trim() || line.migrationCode?.trim() || null
            : line.service === "GAS"
              ? line.pdr?.trim() || line.migrationCode?.trim() || null
              : line.migrationCode?.trim() ||
                line.pod?.trim() ||
                line.pdr?.trim() ||
                null;

        created = await prisma.contract.create({
          data: {
            contractNumber,
            clientId,
            supplierId: lineSupplierId,
            collaboratorId,
            createdById: session.id,
            status,
            utilityType: line.service,
            serviceOther: line.serviceOther || null,
            operationType,
            operationOther:
              line.operationOther || payload.operationOther || null,
            productName: line.productName || payload.productName || null,
            offerCode: line.offerCode || payload.offerCode || null,
            commissionRuleId:
              line.commissionRuleId || payload.commissionRuleId || null,
            contractKind: line.contractKind || payload.contractKind || null,
            priceType: line.priceType || payload.priceType || null,
            pod: line.pod?.trim() || null,
            pdr: line.pdr?.trim() || null,
            podPdr,
            powerKw: num(line.powerKw),
            annualKwh: num(line.annualKwh),
            annualSmc: num(line.annualSmc),
            pricePerKwh: num(line.pricePerKwh || payload.pricePerKwh),
            pricePerSmc: num(line.pricePerSmc || payload.pricePerSmc),
            pcv: num(line.pcv || payload.pcv),
            spread: num(line.spread || payload.spread),
            monthlyFee: num(line.monthlyFee || payload.monthlyFee),
            oneOffFee: num(payload.oneOffFee),
            discount: num(payload.discount),
            economicNotes: payload.economicNotes || null,
            paymentMethod:
              line.paymentMethod || payload.paymentMethod || null,
            contractIban: payload.client.iban || null,
            ibanHolder: line.ibanHolder || payload.ibanHolder || null,
            ibanHolderCf: payload.ibanHolderCf || null,
            invoiceEmail: payload.invoiceEmail || null,
            supplyClassification: classification,
            durationMonths: duration,
            supplyStartDate: supplyStart,
            expiryDate,
            insertionDate,
            addressesMatch: supplySame,
            supplyStreet,
            supplyStreetNumber,
            supplyZipCode,
            supplyCity,
            supplyProvince,
            supplyRegion,
            supplyAddress,
            supplyCountry: "Italia",
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
              priceIndex: line.priceIndex,
            }),
            parentContractId: firstId || null,
          },
          select: { id: true },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg.includes("Contract_contractNumber_key") && attempts < 5) {
          await syncContractNumberSequenceFromExisting();
          continue;
        }
        throw e;
      }
    }
    if (!created) {
      return {
        ok: false,
        errors: ["Non è stato possibile generare il numero del contratto. Riprova."],
        code: "NUMBER_ALLOC_FAILED",
      };
    }

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

    const ruleId = line.commissionRuleId || payload.commissionRuleId;
    const expectedFromRule = ruleId
      ? await prisma.commissionRule.findUnique({
          where: { id: ruleId },
          select: { fixedAmount: true },
        })
      : null;
    const expected = expectedFromRule?.fixedAmount
      ? Number(expectedFromRule.fixedAmount.toString()) || 0
      : 0;

    await prisma.commission.create({
      data: { contractId: created.id, expected },
    });

    // Allegati piccoli solo sul primo contratto; i grandi arrivano via API upload
    if (created.id === firstId) {
      for (const att of payload.attachments) {
        if (!att.contentBase64 || att.contentBase64.length > 500_000) continue;
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

  if (payload.idempotencyKey?.trim() && createdIds.length) {
    await prisma.createIdempotency.create({
      data: {
        key: payload.idempotencyKey.trim(),
        contractIds: JSON.stringify(createdIds),
        userId: session.id,
      },
    }).catch(() => undefined);
  }

  // Email Master inviata dal client via API dopo upload allegati (evita body/timeout Server Action)

  // POD ricontrattualizzato → archivia i precedenti (CRM snello)
  try {
    const { archiveOlderForContractPods } = await import(
      "@/lib/contract-pod-archive"
    );
    await archiveOlderForContractPods(createdIds);
  } catch (e) {
    console.error("[archiveOlderForContractPods]", e);
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

  // Avviso email admin a ogni nuovo contratto reale (non bozze)
  if (!payload.draft && createdIds.length > 0) {
    void import("@/lib/notify-admin-contracts")
      .then(({ notifyAdminNewContracts }) =>
        notifyAdminNewContracts({
          source: "nuovo_contratto",
          contractIds: createdIds,
          byUserName: session.name,
          note: sendToMaster ? "Inviato in coda Master" : undefined,
        }),
      )
      .catch((e) => console.error("[notifyAdminNewContracts]", e));
  }

  revalidatePath("/contratti");
  revalidatePath("/lavorazione");
  revalidatePath("/clienti");
  revalidatePath("/provvigioni");
  revalidatePath("/");

  return {
    ok: true,
    contractIds: createdIds,
    message: payload.draft
      ? "Bozza salvata"
      : sendToMaster
        ? "Contratto creato. Invio email in corso…"
        : `Creat${createdIds.length > 1 ? "i" : "o"} ${createdIds.length} contrat${createdIds.length > 1 ? "ti" : "to"}`,
    code: sendToMaster ? "CREATED_PENDING_EMAIL" : "CREATED",
    emailSent: false,
  };
}
