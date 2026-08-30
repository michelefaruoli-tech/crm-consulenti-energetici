"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ContractStatus } from "@/generated/prisma/client";
import { login, destroySession, requireSession } from "@/lib/auth";
import { calculateExpectedCommission } from "@/lib/commission";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { generateContractNumber } from "@/lib/contract-number";
import {
  computeSupplyStartDate,
  normalizeOperationType,
} from "@/lib/supply-dates";
import { CONTRACT_STATUS_LABELS } from "@/lib/constants";
import { writeClientHistoryBatch } from "@/lib/audit";
import { canonicalSupplierName } from "@/lib/supplier-merge";
import { suggestPersonNameOrder } from "@/lib/italian-person-name";
import { notifyCollaboratorStatusChange } from "@/lib/notify-collaborator-status";

export async function loginAction(formData: FormData): Promise<void> {
  const { isHoneypotFilled, logSecurityEvent } = await import("@/lib/security-log");
  const { getRequestMeta } = await import("@/lib/request-meta");

  if (isHoneypotFilled(formData)) {
    const meta = await getRequestMeta();
    await logSecurityEvent({
      eventType: "HONEYPOT",
      email: String(formData.get("email") ?? "").trim().toLowerCase(),
      details: "campo honeypot compilato (probabile bot)",
      meta,
    });
    // Finta risposta lenta: non rivelare il blocco
    await new Promise((r) => setTimeout(r, 800));
    redirect("/login?error=1");
  }

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const result = await login(email, password);
  if (result.error) {
    const q =
      result.error.includes("Troppi") || result.error.includes("15 minuti")
        ? "blocked"
        : "1";
    redirect(`/login?error=${q}`);
  }
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

const clientSchema = z.object({
  type: z.enum(["PRIVATO", "AZIENDA"]),
  companyName: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  fiscalCode: z.string().optional(),
  vatNumber: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  pec: z.string().optional(),
  iban: z.string().optional(),
  address: z.string().optional(),
  street: z.string().optional(),
  streetNumber: z.string().optional(),
  city: z.string().optional(),
  province: z.string().optional(),
  region: z.string().optional(),
  zipCode: z.string().optional(),
  country: z.string().optional(),
  legalFirstName: z.string().optional(),
  legalLastName: z.string().optional(),
  notes: z.string().optional(),
});

export async function createClientAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "clients.create")) {
    throw new Error("Permesso negato");
  }

  const parsed = clientSchema.safeParse({
    type: formData.get("type"),
    companyName: formData.get("companyName") || undefined,
    firstName: formData.get("firstName") || undefined,
    lastName: formData.get("lastName") || undefined,
    fiscalCode: formData.get("fiscalCode") || undefined,
    vatNumber: formData.get("vatNumber") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    pec: formData.get("pec") || undefined,
    iban: formData.get("iban") || undefined,
    address: formData.get("address") || undefined,
    street: formData.get("street") || undefined,
    streetNumber: formData.get("streetNumber") || undefined,
    city: formData.get("city") || undefined,
    province: formData.get("province") || undefined,
    region: formData.get("region") || undefined,
    zipCode: formData.get("zipCode") || undefined,
    country: formData.get("country") || "Italia",
    legalFirstName: formData.get("legalFirstName") || undefined,
    legalLastName: formData.get("legalLastName") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    throw new Error("Dati non validi");
  }

  let firstName = parsed.data.firstName || null;
  let lastName = parsed.data.lastName || null;
  if (parsed.data.type === "PRIVATO" && firstName && lastName) {
    const ordered = suggestPersonNameOrder(
      firstName,
      lastName,
      parsed.data.fiscalCode,
    );
    if (ordered.swapped && ordered.confidence !== "low") {
      firstName = ordered.firstName;
      lastName = ordered.lastName;
    }
  }

  const data = {
    ...parsed.data,
    email: parsed.data.email || null,
    companyName: parsed.data.companyName || null,
    firstName,
    lastName,
    fiscalCode: parsed.data.fiscalCode || null,
    vatNumber: parsed.data.vatNumber || null,
    phone: parsed.data.phone || null,
    pec: parsed.data.pec || null,
    iban: parsed.data.iban || null,
    address: parsed.data.address || null,
    street: parsed.data.street || null,
    streetNumber: parsed.data.streetNumber || null,
    city: parsed.data.city || null,
    province: parsed.data.province || null,
    region: parsed.data.region || null,
    zipCode: parsed.data.zipCode || null,
    country: parsed.data.country || "Italia",
    legalFirstName: parsed.data.legalFirstName || null,
    legalLastName: parsed.data.legalLastName || null,
    notes: parsed.data.notes || null,
  };

  const client = await prisma.client.create({
    data: { ...data, createdById: session.id },
  });

  await prisma.auditLog.create({
    data: {
      userId: session.id,
      action: "CREATE",
      entity: "Client",
      entityId: client.id,
    },
  });

  revalidatePath("/clienti");
  redirect(`/clienti/${client.id}`);
}

export async function updateClientAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const clientId = String(formData.get("clientId") ?? "");
  if (!clientId) throw new Error("Cliente non specificato");

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) throw new Error("Cliente non trovato");

  const canEditAll = hasPermission(session.role, "clients.edit_all");
  if (!canEditAll && client.createdById !== session.id) {
    // Collaboratore di almeno un contratto del cliente può aggiornare l'anagrafica
    const linked = await prisma.contract.findFirst({
      where: {
        clientId,
        collaboratorId: session.id,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!linked) throw new Error("Permesso negato");
  }

  const next = {
    type: String(formData.get("type") ?? client.type) as "PRIVATO" | "AZIENDA",
    companyName: String(formData.get("companyName") ?? "") || null,
    firstName: String(formData.get("firstName") ?? "") || null,
    lastName: String(formData.get("lastName") ?? "") || null,
    fiscalCode: String(formData.get("fiscalCode") ?? "") || null,
    vatNumber: String(formData.get("vatNumber") ?? "") || null,
    email: String(formData.get("email") ?? "") || null,
    pec: String(formData.get("pec") ?? "") || null,
    phone: String(formData.get("phone") ?? "") || null,
    iban: String(formData.get("iban") ?? "") || null,
    address: String(formData.get("address") ?? "") || null,
    street: String(formData.get("street") ?? "") || null,
    streetNumber: String(formData.get("streetNumber") ?? "") || null,
    city: String(formData.get("city") ?? "") || null,
    province: String(formData.get("province") ?? "") || null,
    region: String(formData.get("region") ?? "") || null,
    zipCode: String(formData.get("zipCode") ?? "") || null,
    country: String(formData.get("country") ?? "") || "Italia",
    classification: String(formData.get("classification") ?? "") || null,
    legalFirstName: String(formData.get("legalFirstName") ?? "") || null,
    legalLastName: String(formData.get("legalLastName") ?? "") || null,
    legalFiscalCode: String(formData.get("legalFiscalCode") ?? "") || null,
    sdiCode: String(formData.get("sdiCode") ?? "") || null,
    notes: String(formData.get("notes") ?? "") || null,
  };

  if (next.type === "PRIVATO" && next.firstName && next.lastName) {
    const ordered = suggestPersonNameOrder(
      next.firstName,
      next.lastName,
      next.fiscalCode,
    );
    if (ordered.swapped && ordered.confidence !== "low") {
      next.firstName = ordered.firstName;
      next.lastName = ordered.lastName;
    }
  }

  // Indirizzo fornitura NON si aggiorna più dall'anagrafica (resta solo sul contratto)
  await prisma.client.update({
    where: { id: clientId },
    data: next,
  });

  const tracked: Array<keyof typeof next> = [
    "type",
    "companyName",
    "firstName",
    "lastName",
    "fiscalCode",
    "vatNumber",
    "email",
    "pec",
    "phone",
    "iban",
    "address",
    "street",
    "streetNumber",
    "city",
    "province",
    "region",
    "zipCode",
    "country",
    "classification",
    "legalFirstName",
    "legalLastName",
    "legalFiscalCode",
    "sdiCode",
    "notes",
  ];
  await writeClientHistoryBatch(
    clientId,
    session.id,
    tracked.map((field) => ({
      field,
      oldValue: String(client[field] ?? "") || null,
      newValue: String(next[field] ?? "") || null,
    })),
  );

  revalidatePath("/clienti");
  revalidatePath(`/clienti/${clientId}`);
  revalidatePath("/contratti");
  revalidatePath("/");
}

export async function createContractAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "contracts.create")) {
    throw new Error("Permesso negato");
  }

  const clientId = String(formData.get("clientId") ?? "");
  const supplierId = String(formData.get("supplierId") ?? "");
  const serviceId = String(formData.get("serviceId") ?? "") || null;
  const commissionRuleId = String(formData.get("commissionRuleId") ?? "") || null;
  const collaboratorId = hasPermission(session.role, "contracts.edit_all")
    ? String(formData.get("collaboratorId") ?? session.id)
    : session.id;
  const notes = String(formData.get("notes") ?? "") || null;
  const expiryDateRaw = String(formData.get("expiryDate") ?? "");
  const operationType = String(formData.get("operationType") ?? "CAMBIO");
  const insertionDate = new Date();
  const op = normalizeOperationType(operationType);
  const supplyStartDate = computeSupplyStartDate(insertionDate, op);

  const rule = commissionRuleId
    ? await prisma.commissionRule.findUnique({ where: { id: commissionRuleId } })
    : null;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { type: true },
  });

  const contractNumber = await generateContractNumber();
  const expected = calculateExpectedCommission(rule, client?.type);

  const created = await prisma.contract.create({
    data: {
      contractNumber,
      clientId,
      supplierId,
      serviceId,
      commissionRuleId,
      collaboratorId,
      notes,
      expiryDate: expiryDateRaw ? new Date(expiryDateRaw) : null,
      status: "INSERITO",
      operationType: op,
      insertionDate,
      supplyStartDate,
    },
  });

  await prisma.contractStatusHistory.create({
    data: {
      contractId: created.id,
      toStatus: "INSERITO",
      changedById: session.id,
    },
  });

  await prisma.commission.create({
    data: {
      contractId: created.id,
      expected,
    },
  });

  const contract = created;

  await prisma.auditLog.create({
    data: {
      userId: session.id,
      action: "CREATE",
      entity: "Contract",
      entityId: contract.id,
    },
  });

  revalidatePath("/contratti");
  redirect(`/contratti/${contract.id}`);
}

export async function updateContractStatusAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const contractId = String(formData.get("contractId") ?? "");
  const toStatus = String(formData.get("status") ?? "") as ContractStatus;
  const note = String(formData.get("note") ?? "") || null;

  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract || contract.deletedAt) {
    redirect("/contratti?error=not_found");
  }

  const canChangeAll = hasPermission(session.role, "contracts.change_status");
  const canChangeOwn =
    hasPermission(session.role, "contracts.edit_own") &&
    contract.collaboratorId === session.id;
  if (!canChangeAll && !canChangeOwn) {
    redirect(`/contratti/${contractId}?error=permesso`);
  }

  const validStatuses = Object.keys(CONTRACT_STATUS_LABELS) as ContractStatus[];
  if (!validStatuses.includes(toStatus)) {
    redirect(`/contratti/${contractId}?error=stato_non_valido`);
  }

  try {
    const updateData: {
      status: ContractStatus;
      activationDate?: Date;
      paymentDate?: Date;
    } = { status: toStatus };

    if (toStatus === "ATTIVATO" && !contract.activationDate) {
      updateData.activationDate = new Date();
    }
    if (toStatus === "PAGATO_DAL_FORNITORE" && !contract.paymentDate) {
      updateData.paymentDate = new Date();
    }

    await prisma.contract.update({
      where: { id: contractId },
      data: updateData,
    });

    await prisma.contractStatusHistory.create({
      data: {
        contractId,
        fromStatus: contract.status,
        toStatus,
        changedById: session.id,
        note,
      },
    });

    const { syncRecurringMonthsForContract } = await import("@/lib/recurring-sync");
    await syncRecurringMonthsForContract(contractId);

    if (toStatus === "PAGATO_DAL_FORNITORE") {
      const commission = await prisma.commission.findUnique({ where: { contractId } });
      if (commission) {
        const amount = Number(commission.expected);
        await prisma.commission.update({
          where: { contractId },
          data: {
            received: amount,
            accrued: amount,
          },
        });
        await prisma.commissionEntry.create({
          data: {
            commissionId: commission.id,
            type: "received",
            amount,
            note: "Pagamento fornitore registrato automaticamente",
          },
        });
      }
    }
  } catch (e) {
    console.error("[updateContractStatusAction]", e);
    redirect(`/contratti/${contractId}?error=aggiornamento_stato`);
  }

  // Solo se Admin/Backoffice (non se l’agente cambia da solo)
  if (canChangeAll) {
    await notifyCollaboratorStatusChange({
      contractId,
      fromStatus: contract.status,
      toStatus,
      changedByName: session.name,
      note,
    });
  }

  revalidatePath("/contratti");
  revalidatePath(`/contratti/${contractId}`);
  revalidatePath("/");
  revalidatePath("/provvigioni");
  redirect(`/contratti/${contractId}`);
}

export async function updateContractCollaboratorAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  // Scheda completa: solo Admin (non Segreteria)
  if (!hasPermission(session.role, "contracts.change_collaborator")) {
    throw new Error("Solo l'amministratore può cambiare il collaboratore dalla scheda completa");
  }

  const contractId = String(formData.get("contractId") ?? "");
  const collaboratorId = String(formData.get("collaboratorId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!contractId || !collaboratorId) {
    throw new Error("Dati mancanti");
  }

  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract || contract.deletedAt) {
    throw new Error("Contratto non trovato");
  }

  const collaborator = await prisma.user.findFirst({
    where: {
      id: collaboratorId,
      active: true,
      role: { in: ["COLLABORATORE", "COMMERCIALE", "AREA_MANAGER", "ADMIN", "SEGRETERIA"] },
    },
  });
  if (!collaborator) {
    throw new Error("Collaboratore non valido");
  }

  if (collaborator.id === contract.collaboratorId) {
    revalidatePath(`/contratti/${contractId}`);
    return;
  }

  const previous = await prisma.user.findUnique({
    where: { id: contract.collaboratorId },
    select: { name: true },
  });

  await prisma.contract.update({
    where: { id: contractId },
    data: { collaboratorId },
  });

  await prisma.auditLog.create({
    data: {
      userId: session.id,
      action: "UPDATE",
      entity: "Contract",
      entityId: contractId,
      details: JSON.stringify({
        field: "collaboratorId",
        from: contract.collaboratorId,
        fromName: previous?.name ?? null,
        to: collaborator.id,
        toName: collaborator.name,
        reason,
        source: "contract_detail",
      }),
    },
  });

  revalidatePath("/contratti");
  revalidatePath(`/contratti/${contractId}`);
  revalidatePath("/");
  revalidatePath("/provvigioni");
}

export async function updateContractOperationAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (
    !hasPermission(session.role, "contracts.edit_all") &&
    !hasPermission(session.role, "contracts.edit_own")
  ) {
    throw new Error("Permesso negato");
  }

  const contractId = String(formData.get("contractId") ?? "");
  const op = normalizeOperationType(String(formData.get("operationType") ?? "CAMBIO"));

  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract) throw new Error("Contratto non trovato");
  if (
    !hasPermission(session.role, "contracts.edit_all") &&
    contract.collaboratorId !== session.id
  ) {
    throw new Error("Permesso negato");
  }

  const supplyStartDate = computeSupplyStartDate(contract.insertionDate, op);

  await prisma.contract.update({
    where: { id: contractId },
    data: { operationType: op, supplyStartDate },
  });

  revalidatePath("/contratti");
  revalidatePath(`/contratti/${contractId}`);
  revalidatePath("/");
}

export async function liquidateCommissionAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "commissions.view_all")) {
    throw new Error("Permesso negato");
  }

  const contractId = String(formData.get("contractId") ?? "");
  const amount = Number(formData.get("amount") ?? 0);

  const commission = await prisma.commission.findUnique({ where: { contractId } });
  if (!commission) {
    throw new Error("Provvigione non trovata");
  }

  const newPaid = Number(commission.paid) + amount;
  await prisma.commission.update({
    where: { contractId },
    data: { paid: newPaid },
  });
  await prisma.commissionEntry.create({
    data: {
      commissionId: commission.id,
      type: "paid",
      amount,
      paidById: session.id,
      note: "Liquidazione collaboratore",
    },
  });
  await prisma.contract.update({
    where: { id: contractId },
    data: { status: "PROVVIGIONE_LIQUIDATA" },
  });
  await prisma.contractStatusHistory.create({
    data: {
      contractId,
      toStatus: "PROVVIGIONE_LIQUIDATA",
      changedById: session.id,
      note: `Liquidata provvigione di € ${amount.toFixed(2)}`,
    },
  });

  revalidatePath("/provvigioni");
  revalidatePath("/contratti");
}

export async function createSupplierAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "suppliers.manage")) {
    throw new Error("Permesso negato");
  }

  const stornoRaw = String(formData.get("stornoMonths") ?? "").trim();
  const stornoMonths = stornoRaw ? Number.parseInt(stornoRaw, 10) : null;
  if (stornoRaw && (!Number.isFinite(stornoMonths) || (stornoMonths ?? 0) < 0)) {
    throw new Error("Mesi di storno non validi");
  }

  const gettoneRaw = String(formData.get("gettone") ?? "").trim().replace(",", ".");
  const gettone = gettoneRaw === "" ? null : Number(gettoneRaw);
  if (gettoneRaw !== "" && (!Number.isFinite(gettone) || (gettone ?? 0) < 0)) {
    throw new Error("Gettone non valido");
  }

  const nameRaw = String(formData.get("name") ?? "").trim();
  const name = canonicalSupplierName(nameRaw) || nameRaw;
  const codeRaw = String(formData.get("code") ?? "").trim();
  const code =
    codeRaw.toUpperCase() ||
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .slice(0, 30);

  // Se esiste già Enel/Edison (o variante), riusa quello
  const existing = await prisma.supplier.findFirst({
    where: {
      active: true,
      OR: [
        { name: { equals: name, mode: "insensitive" } },
        ...(name === "Enel"
          ? [{ name: { startsWith: "Enel", mode: "insensitive" as const } }]
          : name === "Edison"
            ? [{ name: { startsWith: "Edison", mode: "insensitive" as const } }]
            : []),
      ],
    },
  });
  if (existing) {
    await prisma.supplier.update({
      where: { id: existing.id },
      data: {
        name,
        email: String(formData.get("email") ?? "") || existing.email,
        stornoMonths: stornoMonths ?? existing.stornoMonths,
      },
    });
    revalidatePath("/fornitori");
    return;
  }

  const supplier = await prisma.supplier.create({
    data: {
      name,
      code,
      email: String(formData.get("email") ?? "") || null,
      stornoMonths,
    },
  });

  if (gettone != null) {
    await prisma.commissionRule.create({
      data: {
        supplierId: supplier.id,
        name: "Listino base",
        clientSegment: "TUTTI",
        gettoneBase: gettone,
        fixedAmount: gettone,
        paymentType: "UNA_TANTUM",
        active: true,
      },
    });
  }

  revalidatePath("/fornitori");
}

/** Aggiorna solo anagrafica fornitore (nome, codice, email, storno default, attivo). */
export async function updateSupplierListinoAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "suppliers.manage")) {
    throw new Error("Permesso negato");
  }

  const supplierId = String(formData.get("supplierId") ?? "");
  if (!supplierId) throw new Error("Fornitore mancante");

  const nameRaw = String(formData.get("name") ?? "").trim();
  const name = canonicalSupplierName(nameRaw) || nameRaw;
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const email = String(formData.get("email") ?? "").trim() || null;
  const activeRaw = String(formData.get("active") ?? "true").trim().toLowerCase();
  const active = !(activeRaw === "false" || activeRaw === "0" || activeRaw === "no");

  const stornoRaw = String(formData.get("stornoMonths") ?? "").trim();
  const stornoMonths = stornoRaw === "" ? null : Number.parseInt(stornoRaw, 10);
  if (stornoRaw !== "" && (!Number.isFinite(stornoMonths) || (stornoMonths ?? 0) < 0)) {
    throw new Error("Mesi di storno non validi");
  }

  if (!name) throw new Error("Nome fornitore obbligatorio");
  if (!code) throw new Error("Codice fornitore obbligatorio");

  const codeTaken = await prisma.supplier.findFirst({
    where: { code, NOT: { id: supplierId } },
    select: { id: true },
  });
  if (codeTaken) throw new Error(`Codice già usato: ${code}`);

  await prisma.supplier.update({
    where: { id: supplierId },
    data: { name, code, email, active, stornoMonths },
  });

  revalidatePath("/fornitori");
  revalidatePath("/contratti");
  revalidatePath("/provvigioni");
}

function moneyFromForm(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? "").trim().replace(",", ".");
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Importo non valido: ${key}`);
  return n;
}

function buildListinoAmounts(formData: FormData) {
  const gettoneBase = moneyFromForm(formData, "gettoneBase");
  const gettoneRid = moneyFromForm(formData, "gettoneRid");
  const gettoneBollettaWeb = moneyFromForm(formData, "gettoneBollettaWeb");
  const gettoneMail = moneyFromForm(formData, "gettoneMail");
  const gettoneMensile = moneyFromForm(formData, "gettoneMensile");
  const gettoneUnaTantumIniziale = moneyFromForm(formData, "gettoneUnaTantumIniziale");

  const unaTantum =
    (gettoneBase ?? 0) +
    (gettoneRid ?? 0) +
    (gettoneBollettaWeb ?? 0) +
    (gettoneMail ?? 0) +
    (gettoneUnaTantumIniziale ?? 0);

  let paymentType: "UNA_TANTUM" | "MENSILE" = "UNA_TANTUM";
  if ((gettoneMensile ?? 0) > 0 && unaTantum > 0) paymentType = "UNA_TANTUM"; // ibrido: totale UT in fixedAmount
  else if ((gettoneMensile ?? 0) > 0) paymentType = "MENSILE";

  return {
    gettoneBase,
    gettoneRid,
    gettoneBollettaWeb,
    gettoneMail,
    gettoneMensile,
    gettoneUnaTantumIniziale,
    fixedAmount: unaTantum > 0 ? unaTantum : gettoneMensile,
    paymentType,
  };
}

/** Crea una regola listino (es. Dolomiti Privato). */
export async function createListinoRuleAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (
    !hasPermission(session.role, "suppliers.manage") &&
    !hasPermission(session.role, "commission_rules.manage")
  ) {
    throw new Error("Permesso negato");
  }

  const supplierId = String(formData.get("supplierId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!supplierId) throw new Error("Fornitore mancante");
  if (!name) throw new Error("Nome regola obbligatorio");

  const segmentRaw = String(formData.get("clientSegment") ?? "TUTTI").trim().toUpperCase();
  const clientSegment = ["PRIVATO", "BUSINESS", "TUTTI"].includes(segmentRaw)
    ? segmentRaw
    : "TUTTI";

  const stornoRaw = String(formData.get("stornoMonths") ?? "").trim();
  const stornoMonths = stornoRaw === "" ? null : Number.parseInt(stornoRaw, 10);
  if (stornoRaw !== "" && (!Number.isFinite(stornoMonths) || (stornoMonths ?? 0) < 0)) {
    throw new Error("Mesi di storno non validi");
  }

  const amounts = buildListinoAmounts(formData);

  await prisma.commissionRule.create({
    data: {
      supplierId,
      name,
      clientSegment,
      stornoMonths,
      ...amounts,
      active: true,
    },
  });

  revalidatePath("/fornitori");
  revalidatePath("/provvigioni");
}

/** Aggiorna una regola listino esistente. */
export async function updateListinoRuleAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (
    !hasPermission(session.role, "suppliers.manage") &&
    !hasPermission(session.role, "commission_rules.manage")
  ) {
    throw new Error("Permesso negato");
  }

  const ruleId = String(formData.get("ruleId") ?? "");
  if (!ruleId) throw new Error("Regola mancante");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Nome regola obbligatorio");

  const segmentRaw = String(formData.get("clientSegment") ?? "TUTTI").trim().toUpperCase();
  const clientSegment = ["PRIVATO", "BUSINESS", "TUTTI"].includes(segmentRaw)
    ? segmentRaw
    : "TUTTI";

  const stornoRaw = String(formData.get("stornoMonths") ?? "").trim();
  const stornoMonths = stornoRaw === "" ? null : Number.parseInt(stornoRaw, 10);
  if (stornoRaw !== "" && (!Number.isFinite(stornoMonths) || (stornoMonths ?? 0) < 0)) {
    throw new Error("Mesi di storno non validi");
  }

  const activeRaw = String(formData.get("active") ?? "true").trim().toLowerCase();
  const active = !(activeRaw === "false" || activeRaw === "0" || activeRaw === "no");

  const amounts = buildListinoAmounts(formData);

  await prisma.commissionRule.update({
    where: { id: ruleId },
    data: {
      name,
      clientSegment,
      stornoMonths,
      active,
      ...amounts,
    },
  });

  revalidatePath("/fornitori");
  revalidatePath("/contratti");
  revalidatePath("/provvigioni");
}

/** Disattiva una regola listino (soft). */
export async function deactivateListinoRuleAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (
    !hasPermission(session.role, "suppliers.manage") &&
    !hasPermission(session.role, "commission_rules.manage")
  ) {
    throw new Error("Permesso negato");
  }

  const ruleId = String(formData.get("ruleId") ?? "");
  if (!ruleId) throw new Error("Regola mancante");

  await prisma.commissionRule.update({
    where: { id: ruleId },
    data: { active: false },
  });

  revalidatePath("/fornitori");
}

export async function createCommissionRuleAction(formData: FormData): Promise<void> {
  // Retrocompatibilità: usa il form listino completo
  return createListinoRuleAction(formData);
}

export async function deleteUserAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "users.manage")) {
    throw new Error("Permesso negato");
  }

  const userId = String(formData.get("userId") ?? "");
  if (!userId) throw new Error("Utente non specificato");
  if (userId === session.id) {
    throw new Error("Non puoi eliminare l'utente con cui sei collegato");
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("Utente non trovato");

  await prisma.user.update({
    where: { id: userId },
    data: {
      active: false,
      email: `deleted_${Date.now()}_${user.email}`,
      name: `[Eliminato] ${user.name}`,
    },
  });

  revalidatePath("/utenti");
}

/**
 * Disattiva tutti gli altri utenti (tiene solo quello loggato).
 * Richiede conferma esplicita nel form: confirmText = "ELIMINA TUTTI"
 */
export async function deleteAllOtherUsersAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "users.manage")) {
    throw new Error("Permesso negato");
  }

  const confirmText = String(formData.get("confirmText") ?? "").trim();
  if (confirmText !== "ELIMINA TUTTI") {
    throw new Error(
      'Conferma non valida: digita esattamente "ELIMINA TUTTI" per procedere',
    );
  }

  const others = await prisma.user.findMany({
    where: { id: { not: session.id }, active: true },
    select: { id: true, email: true, name: true },
  });

  const now = Date.now();
  for (const user of others) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        active: false,
        email: `deleted_${now}_${user.id}_${user.email}`,
        name: `[Eliminato] ${user.name}`,
      },
    });
  }

  revalidatePath("/utenti");
}

/** Recupera email originale dopo soft-delete. */
function recoverDeletedUserEmail(userId: string, email: string): string {
  const bulk = email.match(new RegExp(`^deleted_\\d+_${userId}_(.+)$`));
  if (bulk?.[1]) return bulk[1];
  const single = email.match(/^deleted_\d+_(.+)$/);
  if (single?.[1]) return single[1];
  return email;
}

function recoverDeletedUserName(name: string): string {
  return name.replace(/^(\[Eliminato\]\s*)+/i, "").trim() || name;
}

/** Ripristina un utente soft-deleted (active=false). */
export async function restoreUserAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "users.manage")) {
    throw new Error("Permesso negato");
  }

  const userId = String(formData.get("userId") ?? "");
  if (!userId) throw new Error("Utente non specificato");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("Utente non trovato");
  if (user.active) throw new Error("Utente già attivo");

  const restoredEmail = recoverDeletedUserEmail(user.id, user.email);
  const restoredName = recoverDeletedUserName(user.name);

  const conflict = await prisma.user.findFirst({
    where: { email: restoredEmail, id: { not: user.id } },
    select: { id: true },
  });
  if (conflict) {
    throw new Error(
      `Impossibile ripristinare: l'email ${restoredEmail} è già usata da un altro account`,
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      active: true,
      email: restoredEmail,
      name: restoredName,
    },
  });

  revalidatePath("/utenti");
}

/** Ripristina tutti gli utenti soft-deleted. */
export async function restoreAllDeletedUsersAction(): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "users.manage")) {
    throw new Error("Permesso negato");
  }

  const deleted = await prisma.user.findMany({
    where: { active: false },
    select: { id: true, email: true, name: true },
  });

  for (const user of deleted) {
    const restoredEmail = recoverDeletedUserEmail(user.id, user.email);
    const restoredName = recoverDeletedUserName(user.name);

    const conflict = await prisma.user.findFirst({
      where: { email: restoredEmail, id: { not: user.id } },
      select: { id: true },
    });
    if (conflict) continue;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        active: true,
        email: restoredEmail,
        name: restoredName,
      },
    });
  }

  revalidatePath("/utenti");
}

/**
 * Cancella dal DB gli utenti già soft-deleted (active=false) che non hanno
 * contratti come collaboratore. Riassegna clienti/audit all’admin corrente.
 * Così spariscono del tutto dalle tendine Collab.
 */
export async function purgeDeletedUsersPermanentlyAction(): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "users.manage")) {
    throw new Error("Permesso negato");
  }

  const deleted = await prisma.user.findMany({
    where: { active: false, id: { not: session.id } },
    select: {
      id: true,
      name: true,
      _count: { select: { contracts: true } },
    },
  });

  for (const user of deleted) {
    if (user._count.contracts > 0) continue;

    // Neon HTTP: niente $transaction / cascade Prisma → SQL grezzo
    const id = user.id;
    const adminId = session.id;
    await prisma.$executeRawUnsafe(
      `UPDATE "Client" SET "createdById" = $1 WHERE "createdById" = $2`,
      adminId,
      id,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "Contract" SET "createdById" = $1 WHERE "createdById" = $2`,
      adminId,
      id,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "ContractStatusHistory" SET "changedById" = $1 WHERE "changedById" = $2`,
      adminId,
      id,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "AuditLog" SET "userId" = $1 WHERE "userId" = $2`,
      adminId,
      id,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "CommissionEntry" SET "paidById" = NULL WHERE "paidById" = $1`,
      id,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "ContractEmailLog" SET "sentById" = NULL WHERE "sentById" = $1`,
      id,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "UserSupplierScope" WHERE "userId" = $1`,
      id,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "UserCollaboratorScope" WHERE "userId" = $1 OR "collaboratorId" = $1`,
      id,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "PasswordResetToken" WHERE "userId" = $1`,
      id,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "UserSecurityEvent" WHERE "userId" = $1`,
      id,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE id = $1`, id);
  }

  revalidatePath("/utenti");
  revalidatePath("/provvigioni");
  revalidatePath("/contratti");
  revalidatePath("/report");
}

/** Backup manuale Excel (+ email opzionale). Restituisce base64 per il download. */
export async function runBackupAction(opts?: {
  sendEmail?: boolean;
}): Promise<
  | { error: string }
  | {
      filename: string;
      /** Excel in base64 (download browser) */
      payloadBase64: string;
      emailed: boolean;
      newContractsToday: number;
      counts: Record<string, number>;
      mailError?: string;
    }
> {
  const session = await requireSession();
  if (!hasPermission(session.role, "backup.manage")) {
    return { error: "Permesso negato" };
  }

  const { runDbExcelBackup } = await import("@/lib/db-backup-runner");
  const result = await runDbExcelBackup({
    mode: "manual",
    sendEmail: Boolean(opts?.sendEmail),
    includeBuffer: true,
  });

  if (!result.buffer || !result.filename) {
    return { error: result.error ?? "Backup non riuscito" };
  }

  return {
    filename: result.filename,
    payloadBase64: result.buffer.toString("base64"),
    emailed: Boolean(result.emailed),
    newContractsToday: result.newContractsToday ?? 0,
    counts: result.counts ?? {},
    mailError: result.error,
  };
}

/** Salva «versione funzionante» (Excel + JSON via email). */
export async function runWorkingSnapshotAction(opts?: {
  note?: string;
  sendEmail?: boolean;
}): Promise<
  | { error: string }
  | {
      filename: string;
      payloadBase64: string;
      emailed: boolean;
      counts: Record<string, number>;
      gitHash?: string;
      jsonFilename?: string;
      jsonIncludedInEmail?: boolean;
      mailError?: string;
    }
> {
  const session = await requireSession();
  if (!hasPermission(session.role, "backup.manage")) {
    return { error: "Permesso negato" };
  }

  const { runWorkingSnapshot } = await import("@/lib/db-backup-runner");
  const result = await runWorkingSnapshot({
    note: opts?.note,
    sendEmail: opts?.sendEmail !== false,
    includeExcelBuffer: true,
  });

  if (!result.buffer || !result.filename) {
    return { error: result.error ?? "Snapshot non riuscito" };
  }

  revalidatePath("/backup");
  revalidatePath("/report");

  return {
    filename: result.filename,
    payloadBase64: result.buffer.toString("base64"),
    emailed: Boolean(result.emailed),
    counts: result.counts ?? {},
    gitHash: result.gitHash,
    jsonFilename: result.jsonFilename,
    jsonIncludedInEmail: result.jsonIncludedInEmail,
    mailError: result.error,
  };
}

/**
 * «Carica ultima funzionante»: Excel fresco dello stato attuale + email,
 * con riferimento all’ultimo snapshot WORKING.
 */
export async function resendWorkingBackupAction(): Promise<
  | { error: string }
  | {
      filename: string;
      payloadBase64: string;
      emailed: boolean;
      lastWorkingAt?: string;
      lastWorkingNote?: string;
      mailError?: string;
      counts: Record<string, number>;
    }
> {
  const session = await requireSession();
  if (!hasPermission(session.role, "backup.manage")) {
    return { error: "Permesso negato" };
  }

  const lastWorking = await prisma.backupLog.findFirst({
    where: { status: { in: ["WORKING", "WORKING_LOCAL"] } },
    orderBy: { createdAt: "desc" },
  });

  const { runDbExcelBackup } = await import("@/lib/db-backup-runner");
  const result = await runDbExcelBackup({
    mode: "manual",
    sendEmail: true,
    includeBuffer: true,
  });

  if (!result.buffer || !result.filename) {
    return { error: result.error ?? "Backup non riuscito" };
  }

  revalidatePath("/backup");

  const noteParts = lastWorking?.filename?.split("|") ?? [];
  return {
    filename: result.filename,
    payloadBase64: result.buffer.toString("base64"),
    emailed: Boolean(result.emailed),
    lastWorkingAt: lastWorking
      ? lastWorking.createdAt.toISOString()
      : undefined,
    lastWorkingNote: noteParts[4] || noteParts[0] || undefined,
    mailError: result.error,
    counts: result.counts ?? {},
  };
}

export async function sendReportEmailAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "reports.email")) {
    throw new Error("Permesso negato");
  }

  if (!process.env.SMTP_HOST) {
    throw new Error("SMTP non configurato. Lascia vuoto per restare gratis, oppure configura .env");
  }

  const to = String(formData.get("to") ?? "");
  const subject = String(formData.get("subject") ?? "Report CRM");
  const body = String(formData.get("body") ?? "");

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    text: body,
  });

  revalidatePath("/report");
}
