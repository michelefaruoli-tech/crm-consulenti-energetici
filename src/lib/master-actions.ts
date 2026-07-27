"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ContractStatus } from "@/generated/prisma/client";
import { requireSession, hashPassword } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sendMail, textToHtmlParagraphs } from "@/lib/mail";
import {
  formatEmailList,
  getLavorazioneNotifyEmails,
  userCanAccessContract,
} from "@/lib/user-scope";
import { buildContractNotificationBody } from "@/lib/contract-notification-email";
import {
  KO_REASON_OPTIONS,
  validateMasterTransition,
} from "@/lib/master-workflow";
import { formatRomeDateTime } from "@/lib/timezone";
import bcrypt from "bcryptjs";

function num(v: FormDataEntryValue | null): number | null {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Cambio stato operativo Master */
export async function updateMasterWorkflowAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const contractId = String(formData.get("contractId") ?? "");
  const toStatus = String(formData.get("status") ?? "") as ContractStatus;
  const note = String(formData.get("note") ?? "") || null;
  const koReason = String(formData.get("koReason") ?? "") || undefined;
  const koOtherText = String(formData.get("koOtherText") ?? "") || undefined;
  const koNotes = String(formData.get("koNotes") ?? "") || undefined;
  const activationDate = String(formData.get("activationDate") ?? "") || undefined;
  const paymentDate = String(formData.get("paymentDate") ?? "") || undefined;
  const paymentConfirmed = formData.get("paymentConfirmed") === "on";
  const expectedPaymentAmount = num(formData.get("expectedPaymentAmount"));
  const expectedPaymentDate = String(formData.get("expectedPaymentDate") ?? "") || undefined;
  const paymentAmount = num(formData.get("paymentAmount"));
  const workNotes = String(formData.get("workNotes") ?? "") || null;
  const integrationNotes =
    String(formData.get("integrationNotes") ?? "").trim() || undefined;

  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract || contract.deletedAt) {
    redirect("/lavorazione?error=not_found");
  }

  const isAdmin =
    hasPermission(session.role, "contracts.change_status") ||
    hasPermission(session.role, "contracts.edit_all");
  if (!isAdmin) {
    redirect(`/lavorazione/${contractId}?error=permesso`);
  }
  if (!(await userCanAccessContract(session, contract))) {
    redirect(`/lavorazione/${contractId}?error=permesso`);
  }
  if (!contract.sendToMaster || !contract.assignedToMaster) {
    redirect(`/lavorazione/${contractId}?error=non_master`);
  }

  const errors = validateMasterTransition({
    from: contract.status,
    to: toStatus,
    allowAdminOverride: isAdmin && formData.get("forceOverride") === "on",
    koReason,
    koNotes: toStatus === "DOCUMENTAZIONE_INCOMPLETA" ? integrationNotes ?? koNotes : koNotes,
    koOtherText,
    activationDate,
    paymentDate,
    paymentConfirmed,
    integrationNotes,
  });
  if (errors.length) {
    redirect(
      `/lavorazione/${contractId}?error=${encodeURIComponent(errors[0] ?? "validazione")}`,
    );
  }

  const koLabel =
    KO_REASON_OPTIONS.find((k) => k.value === koReason)?.label ?? koReason;
  const resolvedKo =
    koReason === "ALTRO" ? `Altro: ${koOtherText}` : koLabel;

  const updateData: Record<string, unknown> = {
    status: toStatus,
    workStatus: toStatus,
    workNotes,
  };

  // Legacy: Completato / Attivato (UI rimossa, resta compatibilità)
  if (toStatus === "COMPLETATO") {
    updateData.workCompletedAt = new Date();
    if (activationDate) updateData.activationDate = new Date(activationDate);
    if (paymentDate) updateData.paymentDate = new Date(paymentDate);
    else if (paymentConfirmed) updateData.paymentDate = new Date();
    if (paymentAmount != null) updateData.paymentAmount = paymentAmount;
  }
  if (toStatus === "IN_ATTESA_PAGAMENTO") {
    updateData.workCompletedAt = new Date();
    if (expectedPaymentAmount != null) updateData.expectedPaymentAmount = expectedPaymentAmount;
    if (expectedPaymentDate) updateData.expectedPaymentDate = new Date(expectedPaymentDate);
  }
  if (toStatus === "ATTIVATO") {
    if (activationDate) updateData.activationDate = new Date(activationDate);
    if (paymentDate) updateData.paymentDate = new Date(paymentDate);
    else if (paymentConfirmed) updateData.paymentDate = new Date();
    if (paymentAmount != null) updateData.paymentAmount = paymentAmount;
  }
  if (toStatus === "DOCUMENTAZIONE_INCOMPLETA") {
    updateData.koNotes = integrationNotes ?? koNotes ?? workNotes;
  }
  if (toStatus === "KO") {
    updateData.koReason = resolvedKo;
    updateData.koNotes = koNotes;
  }

  try {
    await prisma.contract.update({ where: { id: contractId }, data: updateData });
    await prisma.contractStatusHistory.create({
      data: {
        contractId,
        fromStatus: contract.status,
        toStatus,
        changedById: session.id,
        note,
        changeReason: `Cambio stato Master: ${contract.status} → ${toStatus}`,
        koReason: toStatus === "KO" ? resolvedKo : null,
        expectedPaymentAmount:
          toStatus === "IN_ATTESA_PAGAMENTO" ? expectedPaymentAmount : null,
        expectedPaymentDate:
          toStatus === "IN_ATTESA_PAGAMENTO" && expectedPaymentDate
            ? new Date(expectedPaymentDate)
            : null,
        activationDate:
          (toStatus === "ATTIVATO" || toStatus === "COMPLETATO") && activationDate
            ? new Date(activationDate)
            : null,
        paymentDate:
          toStatus === "ATTIVATO" || toStatus === "COMPLETATO"
            ? paymentDate
              ? new Date(paymentDate)
              : paymentConfirmed
                ? new Date()
                : null
            : null,
        paymentAmount:
          toStatus === "ATTIVATO" || toStatus === "COMPLETATO" ? paymentAmount : null,
      },
    });
  } catch (e) {
    console.error("[updateMasterWorkflowAction]", e);
    const msg = e instanceof Error ? e.message : "Errore aggiornamento stato";
    redirect(
      `/lavorazione/${contractId}?error=${encodeURIComponent(
        msg.includes("HTTP mode")
          ? "Errore database. Riprova tra qualche secondo."
          : msg.slice(0, 180),
      )}`,
    );
  }

  revalidatePath("/lavorazione");
  revalidatePath(`/lavorazione/${contractId}`);
  revalidatePath(`/contratti/${contractId}`);
  revalidatePath("/");
  redirect(`/lavorazione/${contractId}?ok=1`);
}

/** Reinvio email Master (solo admin) */
export async function resendMasterEmailAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "contracts.edit_all")) {
    redirect("/lavorazione?error=permesso");
  }
  const contractId = String(formData.get("contractId") ?? "");
  const reason = String(formData.get("resendReason") ?? "").trim();
  if (!reason) {
    redirect(`/lavorazione/${contractId}?error=motivo_reinvio`);
  }

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: {
      client: true,
      supplier: true,
      collaborator: true,
      documents: true,
    },
  });
  if (!contract || !contract.sendToMaster) {
    redirect("/lavorazione?error=not_found");
  }

  const recipients = await getLavorazioneNotifyEmails(contract.supplierId);
  const toEmail = formatEmailList(recipients);
  const { subject, body } = buildContractNotificationBody(contract, {
    resendReason: reason,
    resentBy: session.name,
  });

  const hash = createHash("sha256")
    .update(`resend:${contractId}:${reason}:${Date.now()}`)
    .digest("hex");

  const atts: { filename: string; content: Buffer; contentType?: string }[] = [];
  let bytes = 0;
  for (const d of contract.documents.slice(0, 8)) {
    if (!d.contentBase64) continue;
    try {
      const buf = Buffer.from(d.contentBase64, "base64");
      if (buf.length === 0) continue;
      if (bytes + buf.length > 7 * 1024 * 1024) break;
      bytes += buf.length;
      atts.push({
        filename: d.filename,
        content: buf,
        contentType: d.mimeType || "application/octet-stream",
      });
    } catch {
      // salta file corrotti
    }
  }

  const mail = await sendMail({
    to: recipients,
    subject,
    text: body,
    html: textToHtmlParagraphs(body),
    attachments: atts,
  });

  await prisma.contractEmailLog.create({
    data: {
      contractId,
      toEmail,
      subject,
      status: mail.ok ? "SENT" : mail.skipped ? "SKIPPED_NO_SMTP" : "ERROR",
      emailType: "MASTER_RESEND",
      error: mail.error,
      messageId: mail.messageId,
      sentById: session.id,
      payloadHash: hash,
      sentAt: mail.ok ? new Date() : null,
    },
  });

  await prisma.contract.update({
    where: { id: contractId },
    data: {
      emailAttempts: { increment: 1 },
      emailStatus: mail.ok ? "SENT" : mail.skipped ? "SKIPPED_NO_SMTP" : "ERROR",
      emailLastError: mail.ok ? null : mail.error,
      emailMessageId: mail.messageId ?? undefined,
      sentToMasterAt: mail.ok ? new Date() : contract.sentToMasterAt,
      workEmailDate: mail.ok ? new Date() : contract.workEmailDate,
    },
  });

  revalidatePath(`/lavorazione/${contractId}`);
  redirect(
    mail.ok
      ? `/lavorazione/${contractId}?ok=reinvio`
      : `/lavorazione/${contractId}?error=${encodeURIComponent(mail.error ?? "invio")}`,
  );
}

export async function changeOwnPasswordAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; message?: string }> {
  const session = await requireSession();
  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  const { validatePassword } = await import("@/lib/password-policy");
  const check = validatePassword(next, { email: session.email });
  if (!check.ok) return { ok: false, error: check.error };

  if (next !== confirm) {
    return { ok: false, error: "Nuova password e conferma non coincidono" };
  }
  if (current === next) {
    return { ok: false, error: "La nuova password deve essere diversa da quella attuale" };
  }

  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) return { ok: false, error: "Utente non trovato" };

  const valid = await bcrypt.compare(current, user.password);
  if (!valid) return { ok: false, error: "Password attuale non corretta" };

  await prisma.user.update({
    where: { id: session.id },
    data: {
      password: await hashPassword(next),
      passwordChangedAt: new Date(),
    },
  });
  {
    const { logSecurityEvent } = await import("@/lib/security-log");
    const { getRequestMeta } = await import("@/lib/request-meta");
    await logSecurityEvent({
      eventType: "PASSWORD_CHANGED",
      userId: session.id,
      email: session.email,
      details: "cambio password da account",
      meta: await getRequestMeta(),
    });
  }
  await prisma.auditLog.create({
    data: {
      userId: session.id,
      action: "PASSWORD_CHANGE",
      entity: "User",
      entityId: session.id,
    },
  });

  return { ok: true, message: "Password aggiornata correttamente" };
}

export async function requestPasswordResetAction(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const { isHoneypotFilled, isAuthRateLimited, logSecurityEvent } =
    await import("@/lib/security-log");
  const { getRequestMeta } = await import("@/lib/request-meta");
  const meta = await getRequestMeta();

  // Risposta generica anti-enumerazione
  const generic =
    "Se l'indirizzo è registrato, riceverai un'email con il link di reset (valido 1 ora).";

  if (isHoneypotFilled(formData)) {
    await logSecurityEvent({
      eventType: "HONEYPOT",
      email: String(formData.get("email") ?? "").trim().toLowerCase(),
      details: "forgot-password honeypot",
      meta,
    });
    await new Promise((r) => setTimeout(r, 600));
    return { ok: true, message: generic };
  }

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  const limited = await isAuthRateLimited({
    email,
    ipAddress: meta.ipAddress,
  });
  if (limited.blocked) {
    await logSecurityEvent({
      eventType: "PASSWORD_RESET_BLOCKED",
      email,
      details: limited.reason,
      meta,
    });
    return {
      ok: false,
      message: limited.reason ?? "Troppi tentativi. Riprova tra 15 minuti.",
    };
  }

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, active: true },
  });
  if (!user) {
    await logSecurityEvent({
      eventType: "PASSWORD_RESET_REQUESTED",
      email,
      details: "email non trovata (risposta generica inviata)",
      meta,
    });
    return { ok: true, message: generic };
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });
  await logSecurityEvent({
    eventType: "PASSWORD_RESET_REQUESTED",
    userId: user.id,
    email: user.email,
    meta,
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://crm.fmconsulenza.it";
  const link = `${appUrl}/reset-password?token=${token}`;
  const body = [
    `Ciao ${user.name},`,
    "",
    "Hai richiesto il reset della password del CRM FM Consulenza.",
    `Apri questo link entro 1 ora: ${link}`,
    "",
    "Se non hai richiesto tu il reset, ignora questa email.",
  ].join("\n");

  await sendMail({
    to: user.email,
    subject: "Reset password CRM FM Consulenza",
    text: body,
    html: textToHtmlParagraphs(body),
  });

  return { ok: true, message: generic };
}

export async function resetPasswordWithTokenAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; message?: string }> {
  const token = String(formData.get("token") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (!token) return { ok: false, error: "Token mancante" };

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { email: true } } },
  });
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    return { ok: false, error: "Link non valido o scaduto" };
  }

  const { validatePassword } = await import("@/lib/password-policy");
  const check = validatePassword(next, { email: row.user.email });
  if (!check.ok) return { ok: false, error: check.error };

  if (next !== confirm) return { ok: false, error: "Le password non coincidono" };

  const hashed = await hashPassword(next);
  await prisma.user.update({
    where: { id: row.userId },
    data: {
      password: hashed,
      passwordChangedAt: new Date(),
    },
  });
  await prisma.passwordResetToken.update({
    where: { id: row.id },
    data: { usedAt: new Date() },
  });
  const { logSecurityEvent } = await import("@/lib/security-log");
  const { getRequestMeta } = await import("@/lib/request-meta");
  await logSecurityEvent({
    eventType: "PASSWORD_RESET_COMPLETED",
    userId: row.userId,
    email: row.user.email,
    meta: await getRequestMeta(),
  });

  return { ok: true, message: "Password reimpostata. Ora puoi accedere." };
}

export async function adminSendPasswordResetAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!hasPermission(session.role, "users.manage")) {
    redirect("/utenti?error=permesso");
  }
  const userId = String(formData.get("userId") ?? "");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect("/utenti?error=not_found");

  const fd = new FormData();
  fd.set("email", user.email);
  await requestPasswordResetAction(fd);
  redirect("/utenti?ok=reset_inviato");
}

/**
 * Admin/Segreteria imposta direttamente una nuova password per un utente
 * (senza email di reset). Utile per collaboratori senza casella email.
 */
export async function adminSetUserPasswordAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; message?: string }> {
  const session = await requireSession();
  if (!hasPermission(session.role, "users.manage")) {
    return { ok: false, error: "Permesso negato" };
  }

  const userId = String(formData.get("userId") ?? "").trim();
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (!userId) return { ok: false, error: "Utente non specificato" };
  if (next !== confirm) {
    return { ok: false, error: "Password e conferma non coincidono" };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, active: true },
  });
  if (!user) return { ok: false, error: "Utente non trovato" };
  if (!user.active) {
    return { ok: false, error: "Utente disattivato: ripristinalo prima" };
  }

  const { validatePassword } = await import("@/lib/password-policy");
  const check = validatePassword(next, { email: user.email });
  if (!check.ok) return { ok: false, error: check.error };

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: await hashPassword(next),
      passwordChangedAt: new Date(),
    },
  });
  {
    const { logSecurityEvent } = await import("@/lib/security-log");
    const { getRequestMeta } = await import("@/lib/request-meta");
    await logSecurityEvent({
      eventType: "PASSWORD_CHANGED",
      userId: user.id,
      email: user.email,
      details: `impostata da admin ${session.email}`,
      meta: await getRequestMeta(),
    });
  }
  await prisma.auditLog.create({
    data: {
      userId: session.id,
      action: "PASSWORD_SET_BY_ADMIN",
      entity: "User",
      entityId: user.id,
      details: JSON.stringify({
        targetEmail: user.email,
        targetName: user.name,
        byAdminId: session.id,
      }),
    },
  });

  revalidatePath("/utenti");
  return {
    ok: true,
    message: `Password aggiornata per ${user.name}. Comunicala al collaboratore.`,
  };
}
