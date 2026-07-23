"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ContractStatus } from "@/generated/prisma/client";
import { login, destroySession, requireSession } from "@/lib/auth";
import { calculateExpectedCommission } from "@/lib/commission";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { generateContractNumber } from "@/lib/utils";
import {
  computeSupplyStartDate,
  normalizeOperationType,
} from "@/lib/supply-dates";
import { CONTRACT_STATUS_LABELS } from "@/lib/constants";

export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const result = await login(email, password);
  if (result.error) {
    redirect("/login?error=1");
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
  address: z.string().optional(),
  city: z.string().optional(),
  province: z.string().optional(),
  zipCode: z.string().optional(),
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
    address: formData.get("address") || undefined,
    city: formData.get("city") || undefined,
    province: formData.get("province") || undefined,
    zipCode: formData.get("zipCode") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    throw new Error("Dati non validi");
  }

  const client = await prisma.client.create({
    data: { ...parsed.data, createdById: session.id },
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
    throw new Error("Permesso negato");
  }

  await prisma.client.update({
    where: { id: clientId },
    data: {
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
      city: String(formData.get("city") ?? "") || null,
      province: String(formData.get("province") ?? "") || null,
      region: String(formData.get("region") ?? "") || null,
      zipCode: String(formData.get("zipCode") ?? "") || null,
      classification: String(formData.get("classification") ?? "") || null,
      supplyAddress: String(formData.get("supplyAddress") ?? "") || null,
      supplyCity: String(formData.get("supplyCity") ?? "") || null,
      supplyProvince: String(formData.get("supplyProvince") ?? "") || null,
      supplyRegion: String(formData.get("supplyRegion") ?? "") || null,
      supplyZipCode: String(formData.get("supplyZipCode") ?? "") || null,
      notes: String(formData.get("notes") ?? "") || null,
    },
  });

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

  const contractNumber = await generateContractNumber();
  const expected = calculateExpectedCommission(rule);

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

    await prisma.$transaction(async (tx) => {
      await tx.contract.update({
        where: { id: contractId },
        data: updateData,
      });

      await tx.contractStatusHistory.create({
        data: {
          contractId,
          fromStatus: contract.status,
          toStatus,
          changedById: session.id,
          note,
        },
      });

      if (toStatus === "PAGATO_DAL_FORNITORE") {
        const commission = await tx.commission.findUnique({ where: { contractId } });
        if (commission) {
          const amount = Number(commission.expected);
          await tx.commission.update({
            where: { contractId },
            data: {
              received: amount,
              accrued: amount,
            },
          });
          await tx.commissionEntry.create({
            data: {
              commissionId: commission.id,
              type: "received",
              amount,
              note: "Pagamento fornitore registrato automaticamente",
            },
          });
        }
      }
    });
  } catch (e) {
    console.error("[updateContractStatusAction]", e);
    redirect(`/contratti/${contractId}?error=aggiornamento_stato`);
  }

  revalidatePath("/contratti");
  revalidatePath(`/contratti/${contractId}`);
  revalidatePath("/");
  revalidatePath("/provvigioni");
  redirect(`/contratti/${contractId}`);
}

export async function updateContractCollaboratorAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "contracts.edit_all")) {
    throw new Error("Solo amministratore/segreteria può cambiare il collaboratore");
  }

  const contractId = String(formData.get("contractId") ?? "");
  const collaboratorId = String(formData.get("collaboratorId") ?? "");
  if (!contractId || !collaboratorId) {
    throw new Error("Dati mancanti");
  }

  const collaborator = await prisma.user.findFirst({
    where: {
      id: collaboratorId,
      active: true,
      role: { in: ["COLLABORATORE", "COMMERCIALE", "ADMIN", "SEGRETERIA"] },
    },
  });
  if (!collaborator) {
    throw new Error("Collaboratore non valido");
  }

  await prisma.contract.update({
    where: { id: contractId },
    data: { collaboratorId },
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

  await prisma.$transaction(async (tx) => {
    const newPaid = Number(commission.paid) + amount;
    await tx.commission.update({
      where: { contractId },
      data: { paid: newPaid },
    });
    await tx.commissionEntry.create({
      data: {
        commissionId: commission.id,
        type: "paid",
        amount,
        paidById: session.id,
        note: "Liquidazione collaboratore",
      },
    });
    await tx.contract.update({
      where: { id: contractId },
      data: { status: "PROVVIGIONE_LIQUIDATA" },
    });
    await tx.contractStatusHistory.create({
      data: {
        contractId,
        toStatus: "PROVVIGIONE_LIQUIDATA",
        changedById: session.id,
        note: `Liquidata provvigione di € ${amount.toFixed(2)}`,
      },
    });
  });

  revalidatePath("/provvigioni");
  revalidatePath("/contratti");
}

export async function createSupplierAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "suppliers.manage")) {
    throw new Error("Permesso negato");
  }

  await prisma.supplier.create({
    data: {
      name: String(formData.get("name") ?? ""),
      code: String(formData.get("code") ?? "").toUpperCase(),
      email: String(formData.get("email") ?? "") || null,
    },
  });

  revalidatePath("/fornitori");
}

export async function createCommissionRuleAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "commission_rules.manage")) {
    throw new Error("Permesso negato");
  }

  await prisma.commissionRule.create({
    data: {
      supplierId: String(formData.get("supplierId") ?? ""),
      serviceId: String(formData.get("serviceId") ?? "") || null,
      name: String(formData.get("name") ?? ""),
      paymentType: String(formData.get("paymentType") ?? "UNA_TANTUM") as
        | "MENSILE"
        | "UNA_TANTUM"
        | "RATEIZZATO"
        | "BONUS"
        | "PREMIO",
      fixedAmount: Number(formData.get("fixedAmount") ?? 0),
      installments: Number(formData.get("installments") ?? 0) || null,
    },
  });

  revalidatePath("/fornitori");
  revalidatePath("/provvigioni");
}

export async function createUserAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "users.manage")) {
    throw new Error("Permesso negato");
  }

  const { hashPassword } = await import("@/lib/auth");
  await prisma.user.create({
    data: {
      email: String(formData.get("email") ?? ""),
      name: String(formData.get("name") ?? ""),
      role: String(formData.get("role") ?? "COLLABORATORE") as
        | "ADMIN"
        | "SEGRETERIA"
        | "COLLABORATORE"
        | "COMMERCIALE",
      password: await hashPassword(String(formData.get("password") ?? "")),
    },
  });

  revalidatePath("/utenti");
}

/** Elimina un utente: sempre soft-delete (libera email) per evitare errori FK. */
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

/** Disattiva tutti gli altri utenti (tiene solo quello loggato). */
export async function deleteAllOtherUsersAction(): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "users.manage")) {
    throw new Error("Permesso negato");
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

export async function runBackupAction(): Promise<
  { error: string } | { filename: string; payload: string }
> {
  const session = await requireSession();
  if (!hasPermission(session.role, "backup.manage")) {
    return { error: "Permesso negato" };
  }

  const filename = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const [users, clients, contracts, commissions, suppliers] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, active: true },
    }),
    prisma.client.findMany(),
    prisma.contract.findMany(),
    prisma.commission.findMany({ include: { entries: true } }),
    prisma.supplier.findMany({ include: { services: true, commissionRules: true } }),
  ]);

  const payload = JSON.stringify(
    { users, clients, contracts, commissions, suppliers },
    null,
    2,
  );

  await prisma.backupLog.create({
    data: {
      filename,
      size: Buffer.byteLength(payload),
      status: "SUCCESS",
    },
  });

  return { filename, payload };
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
