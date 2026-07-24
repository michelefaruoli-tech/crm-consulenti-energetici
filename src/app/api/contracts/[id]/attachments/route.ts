import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getMasterEmail, sendMail, textToHtmlParagraphs } from "@/lib/mail";
import { clientDisplayName } from "@/lib/utils";
import { formatRomeDateTime } from "@/lib/timezone";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";

/** Upload allegati dopo creazione contratto (evita limite body Server Action). */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, message: "Non autenticato" }, { status: 401 });
    }
    if (!hasPermission(session.role, "contracts.create")) {
      return NextResponse.json({ success: false, message: "Permesso negato" }, { status: 403 });
    }

    const { id } = await context.params;
    const contract = await prisma.contract.findUnique({
      where: { id },
      select: { id: true, clientId: true, collaboratorId: true },
    });
    if (!contract) {
      return NextResponse.json({ success: false, message: "Contratto non trovato" }, { status: 404 });
    }

    const form = await request.formData();
    const files = form.getAll("files");
    const docTypes = form.getAll("docTypes");
    let saved = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!(file instanceof File)) continue;
      if (file.size > 5 * 1024 * 1024) continue;
      const buf = Buffer.from(await file.arrayBuffer());
      const docType = String(docTypes[i] ?? "ALTRO");
      await prisma.document.create({
        data: {
          contractId: contract.id,
          clientId: contract.clientId,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          path: `db://upload-${Date.now()}-${i}`,
          docType,
          contentBase64: buf.toString("base64"),
        },
      });
      saved++;
    }

    return NextResponse.json({ success: true, saved });
  } catch (e) {
    console.error("[attachments upload]", e);
    return NextResponse.json(
      { success: false, message: "Upload allegati non riuscito" },
      { status: 500 },
    );
  }
}

/** Invio / reinvio email Master dopo salvataggio + allegati. */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, message: "Non autenticato" }, { status: 401 });
    }
    if (!hasPermission(session.role, "contracts.create")) {
      return NextResponse.json({ success: false, message: "Permesso negato" }, { status: 403 });
    }
    const { id } = await context.params;
    const contract = await prisma.contract.findUnique({
      where: { id },
      include: {
        client: true,
        supplier: true,
        collaborator: true,
        documents: true,
      },
    });
    if (!contract) {
      return NextResponse.json({ success: false, message: "Contratto non trovato" }, { status: 404 });
    }

    if (contract.emailStatus === "SENT" && contract.emailIdempotencyKey) {
      return NextResponse.json({
        success: true,
        emailSent: true,
        message: "Email già inviata in precedenza",
        contractId: contract.id,
      });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://crm.fmconsulenza.it";
    const subject = `Nuovo contratto da lavorare – ${contract.contractNumber} – ${clientDisplayName(contract.client)} – ${contract.utilityType || ""}`;
    const body = [
      "Il contratto è nella coda «In lavorazione».",
      `Numero pratica: ${contract.contractNumber}`,
      `Data: ${formatRomeDateTime(new Date())}`,
      `Collaboratore: ${contract.collaborator.name}`,
      `Cliente: ${clientDisplayName(contract.client)}`,
      `CF: ${contract.client.fiscalCode || "—"}`,
      `P.IVA: ${contract.client.vatNumber || "—"}`,
      `Telefono: ${contract.client.phone || "—"}`,
      `Email: ${contract.client.email || "—"}`,
      `Servizio: ${contract.utilityType || "—"}`,
      `Operazione: ${contract.operationType || "—"}`,
      `Fornitore: ${contract.supplier.name}`,
      `POD: ${contract.pod || "—"}`,
      `PDR: ${contract.pdr || "—"}`,
      `POD / PDR: ${contract.podPdr || "—"}`,
      `Note: ${contract.masterNotes || contract.notes || "—"}`,
      `Allegati: ${contract.documents.map((d) => d.filename).join(", ") || "nessuno"}`,
      `Link: ${appUrl}/lavorazione/${contract.id}`,
    ].join("\n");

    const hash = createHash("sha256")
      .update(`master:${contract.id}:${contract.contractNumber}`)
      .digest("hex");

    const atts: { filename: string; content: Buffer; contentType?: string }[] = [];
    let bytes = 0;
    for (const d of contract.documents.slice(0, 6)) {
      if (!d.contentBase64) continue;
      const buf = Buffer.from(d.contentBase64, "base64");
      if (bytes + buf.length > 4 * 1024 * 1024) break;
      bytes += buf.length;
      atts.push({ filename: d.filename, content: buf, contentType: d.mimeType });
    }

    const mail = await sendMail({
      to: getMasterEmail(),
      subject,
      text: body,
      html: textToHtmlParagraphs(body),
      attachments: atts,
    });

    await prisma.contractEmailLog.create({
      data: {
        contractId: contract.id,
        toEmail: getMasterEmail(),
        subject,
        status: mail.ok ? "SENT" : mail.skipped ? "SKIPPED_NO_SMTP" : "ERROR",
        emailType: "MASTER_NEW",
        error: mail.error,
        messageId: mail.messageId,
        sentById: session.id,
        payloadHash: hash,
        sentAt: mail.ok ? new Date() : null,
      },
    });

    await prisma.contract.update({
      where: { id: contract.id },
      data: {
        emailStatus: mail.ok ? "SENT" : mail.skipped ? "SKIPPED_NO_SMTP" : "ERROR",
        emailLastError: mail.ok ? null : mail.error,
        emailMessageId: mail.messageId ?? undefined,
        emailAttempts: { increment: 1 },
        emailIdempotencyKey: hash,
        sentToMasterAt: mail.ok ? new Date() : contract.sentToMasterAt,
        workEmailDate: mail.ok ? new Date() : contract.workEmailDate,
        masterEmail: getMasterEmail(),
      },
    });

    return NextResponse.json({
      success: true,
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      emailSent: mail.ok,
      message: mail.ok
        ? "Email inviata al Master"
        : `Contratto salvato. Email non inviata: ${mail.error ?? "errore SMTP"}`,
      code: mail.ok ? "OK" : "EMAIL_SEND_FAILED",
    });
  } catch (e) {
    console.error("[master email]", e);
    return NextResponse.json(
      { success: false, message: "Errore durante l'invio email" },
      { status: 500 },
    );
  }
}
