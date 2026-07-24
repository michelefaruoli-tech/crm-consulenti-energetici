import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getMasterEmail, sendMail, textToHtmlParagraphs } from "@/lib/mail";
import { clientDisplayName } from "@/lib/utils";
import { formatRomeDateTime } from "@/lib/timezone";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Upload allegati dopo creazione contratto. */
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
      select: { id: true, clientId: true },
    });
    if (!contract) {
      return NextResponse.json({ success: false, message: "Contratto non trovato" }, { status: 404 });
    }

    const form = await request.formData();
    const files = form.getAll("files");
    const docTypes = form.getAll("docTypes");
    let saved = 0;
    const names: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const entry = files[i];
      // In Node/Vercel può arrivare come File o Blob
      if (!(entry instanceof Blob)) continue;
      if (entry.size <= 0 || entry.size > 5 * 1024 * 1024) continue;

      const buf = Buffer.from(await entry.arrayBuffer());
      const filename =
        entry instanceof File && entry.name
          ? entry.name
          : `allegato-${i + 1}.bin`;
      const mimeType =
        entry.type ||
        (filename.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : "application/octet-stream");
      const docType = String(docTypes[i] ?? "ALTRO");

      await prisma.document.create({
        data: {
          contractId: contract.id,
          clientId: contract.clientId,
          filename,
          mimeType,
          size: buf.length,
          path: `db://upload-${Date.now()}-${i}`,
          docType,
          contentBase64: buf.toString("base64"),
        },
      });
      saved++;
      names.push(filename);
    }

    return NextResponse.json({ success: true, saved, names });
  } catch (e) {
    console.error("[attachments upload]", e);
    return NextResponse.json(
      { success: false, message: "Upload allegati non riuscito" },
      { status: 500 },
    );
  }
}

/** Invio email Master dopo salvataggio + allegati. */
export async function PUT(
  _request: Request,
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

    // Rileggi documenti (dopo upload)
    const contract = await prisma.contract.findUnique({
      where: { id },
      include: {
        client: true,
        supplier: true,
        collaborator: true,
        documents: { orderBy: { uploadedAt: "desc" } },
      },
    });
    if (!contract) {
      return NextResponse.json({ success: false, message: "Contratto non trovato" }, { status: 404 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://crm.fmconsulenza.it";
    const docLinks = contract.documents.map(
      (d) => `- ${d.filename} (${d.docType || "file"}): ${appUrl}/api/documents/${d.id}`,
    );

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
      "",
      "Allegati (scarica dal gestionale, accesso autenticato):",
      ...(docLinks.length ? docLinks : ["- Nessun allegato caricato"]),
      "",
      `Scheda lavorazione: ${appUrl}/lavorazione/${contract.id}`,
    ].join("\n");

    const hash = createHash("sha256")
      .update(
        `master:${contract.id}:${contract.contractNumber}:docs:${contract.documents.length}`,
      )
      .digest("hex");

    // Evita duplicati solo se stesso hash (stessi documenti) già inviato
    const already = await prisma.contractEmailLog.findFirst({
      where: { contractId: contract.id, payloadHash: hash, status: "SENT" },
    });
    if (already) {
      return NextResponse.json({
        success: true,
        emailSent: true,
        message: "Email già inviata con questi allegati",
        contractId: contract.id,
        attachments: contract.documents.length,
      });
    }

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
        error: mail.error
          ? `${mail.error}${atts.length ? "" : " (nessun file allegato in SMTP; link nel testo)"}`
          : atts.length === 0 && contract.documents.length > 0
            ? "Documenti in DB ma non allegati SMTP; link nel corpo email"
            : null,
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
      attachmentsInEmail: atts.length,
      documentsInDb: contract.documents.length,
      message: mail.ok
        ? atts.length
          ? `Email inviata al Master con ${atts.length} allegat${atts.length === 1 ? "o" : "i"}`
          : "Email inviata al Master (allegati come link nel testo)"
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
