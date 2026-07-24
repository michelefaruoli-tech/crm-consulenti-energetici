import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getMasterEmail, sendMail, textToHtmlParagraphs } from "@/lib/mail";
import { clientDisplayName } from "@/lib/utils";
import { formatRomeDateTime } from "@/lib/timezone";
import { createHash } from "node:crypto";
import {
  STORAGE_PROVIDER,
  attachmentConfig,
  emailInlineMaxBytes,
  isAllowedAttachment,
  maxFileBytes,
} from "@/lib/attachment-config";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type IncomingFile = {
  filename: string;
  mimeType: string;
  docType: string;
  buffer: Buffer;
};

function isBlobLike(v: unknown): v is Blob {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Blob).arrayBuffer === "function" &&
    typeof (v as Blob).size === "number"
  );
}

async function saveDocuments(
  contractId: string,
  clientId: string,
  userId: string,
  items: IncomingFile[],
): Promise<{ saved: number; names: string[]; skipped: string[] }> {
  const existing = await prisma.document.aggregate({
    where: { contractId, deletedAt: null },
    _sum: { size: true },
    _count: { id: true },
  });
  let totalBytes = existing._sum.size ?? 0;
  let count = existing._count.id;
  let saved = 0;
  const names: string[] = [];
  const skipped: string[] = [];
  const maxOne = maxFileBytes();
  const maxTotal = attachmentConfig.maxTotalMb * 1024 * 1024;

  for (const item of items) {
    if (count >= attachmentConfig.maxCount) {
      skipped.push(`${item.filename}: raggiunto max ${attachmentConfig.maxCount} allegati`);
      continue;
    }
    if (!isAllowedAttachment(item.filename, item.mimeType)) {
      skipped.push(`${item.filename}: formato non consentito`);
      continue;
    }
    if (item.buffer.length <= 0) {
      skipped.push(`${item.filename}: vuoto`);
      continue;
    }
    if (item.buffer.length > maxOne) {
      skipped.push(
        `${item.filename}: troppo grande (max ${attachmentConfig.maxFileMb}MB)`,
      );
      continue;
    }
    if (totalBytes + item.buffer.length > maxTotal) {
      skipped.push(
        `${item.filename}: supera totale max ${attachmentConfig.maxTotalMb}MB`,
      );
      continue;
    }
    try {
      await prisma.document.create({
        data: {
          contractId,
          clientId,
          filename: item.filename,
          mimeType: item.mimeType || "application/octet-stream",
          size: item.buffer.length,
          path: `db://upload-${Date.now()}-${saved}`,
          docType: item.docType || "ALTRO",
          contentBase64: item.buffer.toString("base64"),
          storageProvider: STORAGE_PROVIDER,
          uploadedById: userId,
        },
      });
      saved++;
      count++;
      totalBytes += item.buffer.length;
      names.push(item.filename);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "errore DB";
      console.error("[attachments] prisma create", msg);
      skipped.push(
        `${item.filename}: ${msg.includes("HTTP") ? "errore database" : "salvataggio fallito"}`,
      );
    }
  }

  return { saved, names, skipped };
}

/** Upload allegati (FormData o JSON base64 singolo). Storage = PostgreSQL Base64. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, message: "Non autenticato" }, { status: 401 });
    }
    if (
      !hasPermission(session.role, "contracts.create") &&
      !hasPermission(session.role, "contracts.edit_all") &&
      !hasPermission(session.role, "contracts.edit_own")
    ) {
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

    const contentType = request.headers.get("content-type") || "";
    const items: IncomingFile[] = [];
    const maxOne = maxFileBytes();

    if (contentType.includes("application/json")) {
      const body = (await request.json()) as {
        filename?: string;
        mimeType?: string;
        docType?: string;
        contentBase64?: string;
      };
      if (!body.contentBase64 || !body.filename) {
        return NextResponse.json(
          { success: false, message: "File mancante (JSON)" },
          { status: 400 },
        );
      }
      let buffer: Buffer;
      try {
        buffer = Buffer.from(body.contentBase64, "base64");
      } catch {
        return NextResponse.json(
          { success: false, message: "Contenuto file non valido" },
          { status: 400 },
        );
      }
      items.push({
        filename: body.filename,
        mimeType: body.mimeType || "application/octet-stream",
        docType: body.docType || "ALTRO",
        buffer,
      });
    } else {
      const form = await request.formData();
      const files = form.getAll("files");
      const docTypes = form.getAll("docTypes");
      for (let i = 0; i < files.length; i++) {
        const entry = files[i];
        if (!isBlobLike(entry)) continue;
        if (entry.size <= 0 || entry.size > maxOne) continue;
        const buf = Buffer.from(await entry.arrayBuffer());
        const filename =
          typeof File !== "undefined" && entry instanceof File && entry.name
            ? entry.name
            : `allegato-${i + 1}.bin`;
        const mimeType =
          entry.type ||
          (filename.toLowerCase().endsWith(".pdf")
            ? "application/pdf"
            : "application/octet-stream");
        items.push({
          filename,
          mimeType,
          docType: String(docTypes[i] ?? "ALTRO"),
          buffer: buf,
        });
      }
    }

    if (items.length === 0) {
      return NextResponse.json(
        {
          success: false,
          saved: 0,
          message: `Nessun file ricevuto. Max ${attachmentConfig.maxFileMb}MB per file; carica uno alla volta se fallisce.`,
          limits: {
            maxFileMb: attachmentConfig.maxFileMb,
            maxTotalMb: attachmentConfig.maxTotalMb,
            maxCount: attachmentConfig.maxCount,
          },
        },
        { status: 400 },
      );
    }

    const result = await saveDocuments(
      contract.id,
      contract.clientId,
      session.id,
      items,
    );

    if (result.saved === 0) {
      return NextResponse.json(
        {
          success: false,
          saved: 0,
          skipped: result.skipped,
          message:
            result.skipped[0] ||
            `Nessun allegato salvato (max ${attachmentConfig.maxFileMb}MB).`,
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      saved: result.saved,
      names: result.names,
      skipped: result.skipped,
      storage: STORAGE_PROVIDER,
      message:
        result.skipped.length > 0
          ? `Salvati ${result.saved}; saltati: ${result.skipped.join("; ")}`
          : `Salvati ${result.saved} allegat${result.saved === 1 ? "o" : "i"}`,
    });
  } catch (e) {
    console.error("[attachments upload]", e);
    return NextResponse.json(
      {
        success: false,
        message: `Upload non riuscito. Max ${attachmentConfig.maxFileMb}MB per file; riprova uno alla volta.`,
      },
      { status: 500 },
    );
  }
}

/** Invio email Master: allegati inline solo se sotto soglia, altrimenti link autenticati. */
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

    const contract = await prisma.contract.findUnique({
      where: { id },
      include: {
        client: true,
        supplier: true,
        collaborator: true,
        documents: {
          where: { deletedAt: null },
          orderBy: { uploadedAt: "desc" },
        },
      },
    });
    if (!contract) {
      return NextResponse.json({ success: false, message: "Contratto non trovato" }, { status: 404 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://crm.fmconsulenza.it";
    const docsWithContent = contract.documents.filter((d) => d.contentBase64);
    const docsMissing = contract.documents.filter((d) => !d.contentBase64);
    const docLinks = contract.documents.map(
      (d) =>
        `- ${d.filename} (${d.docType || "file"}, ${Math.round(d.size / 1024)}KB)${
          d.contentBase64 ? "" : " [solo metadati]"
        }: ${appUrl}/api/documents/${d.id}`,
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
      `Note: ${contract.masterNotes || contract.notes || "—"}`,
      "",
      "Allegati (link protetti, accesso autenticato al CRM):",
      ...(docLinks.length ? docLinks : ["- Nessun allegato caricato"]),
      "",
      `Scheda lavorazione: ${appUrl}/lavorazione/${contract.id}`,
      "",
      "Nota: file grandi possono arrivare solo come link (non in allegato SMTP) per limiti del provider.",
    ].join("\n");

    const hash = createHash("sha256")
      .update(
        `master:${contract.id}:${contract.contractNumber}:docs:${contract.documents.length}`,
      )
      .digest("hex");

    const already = await prisma.contractEmailLog.findFirst({
      where: { contractId: contract.id, payloadHash: hash, status: "SENT" },
    });
    if (already) {
      return NextResponse.json({
        success: true,
        contractSaved: true,
        emailSent: true,
        message: "Email già inviata con questi allegati",
        contractId: contract.id,
      });
    }

    // Inline solo fino a EMAIL_INLINE_MAX_MB (resto = link nel corpo)
    const atts: { filename: string; content: Buffer; contentType?: string }[] = [];
    let bytes = 0;
    const inlineLimit = emailInlineMaxBytes();
    const attachmentErrors: string[] = [];

    for (const d of docsWithContent) {
      try {
        const buf = Buffer.from(d.contentBase64!, "base64");
        if (buf.length === 0) {
          attachmentErrors.push(`${d.filename}: buffer vuoto`);
          continue;
        }
        if (bytes + buf.length > inlineLimit) {
          // non allegare: resta come link
          continue;
        }
        bytes += buf.length;
        atts.push({
          filename: d.filename,
          content: buf,
          contentType: d.mimeType || "application/octet-stream",
        });
      } catch {
        attachmentErrors.push(`${d.filename}: lettura fallita`);
      }
    }

    const attemptAt = new Date();
    const mail = await sendMail({
      to: getMasterEmail(),
      subject,
      text: body,
      html: textToHtmlParagraphs(body),
      attachments: atts,
    });

    const emailStatus = mail.ok
      ? "SENT"
      : mail.skipped
        ? "FAILED"
        : attachmentErrors.length && !atts.length && docsWithContent.length
          ? "ATTACHMENT_ERROR"
          : "FAILED";

    await prisma.contractEmailLog.create({
      data: {
        contractId: contract.id,
        toEmail: getMasterEmail(),
        subject,
        status: mail.ok ? "SENT" : mail.skipped ? "SKIPPED_NO_SMTP" : "ERROR",
        emailType: "MASTER_NEW",
        error: mail.ok
          ? null
          : [mail.error, ...attachmentErrors].filter(Boolean).join(" | ").slice(0, 500),
        messageId: mail.messageId,
        sentById: session.id,
        payloadHash: hash,
        sentAt: mail.ok ? attemptAt : null,
      },
    });

    await prisma.contract.update({
      where: { id: contract.id },
      data: {
        emailStatus,
        emailLastError: mail.ok ? null : mail.error ?? "Invio non riuscito",
        emailMessageId: mail.messageId ?? undefined,
        emailAttempts: { increment: 1 },
        emailLastAttemptAt: attemptAt,
        emailIdempotencyKey: hash,
        sentToMasterAt: mail.ok ? attemptAt : contract.sentToMasterAt,
        workEmailDate: mail.ok ? attemptAt : contract.workEmailDate,
        masterEmail: getMasterEmail(),
      },
    });

    // Opzionale: elimina contenuto Base64 dopo invio OK (metadati restano)
    if (mail.ok && attachmentConfig.deleteAfterEmail) {
      const toClear = contract.documents.filter((d) => d.contentBase64);
      for (const d of toClear) {
        await prisma.document.update({
          where: { id: d.id },
          data: {
            contentBase64: null,
            contentClearedAt: attemptAt,
            contentClearedReason: "DELETE_ATTACHMENTS_AFTER_EMAIL",
            storageProvider: "cleared",
          },
        });
      }
      if (toClear.length) {
        await writeAuditLog({
          userId: session.id,
          action: "CLEAR_ATTACHMENT_CONTENT",
          entity: "Contract",
          entityId: contract.id,
          details: { count: toClear.length, reason: "after_email_sent" },
        });
      }
    }

    if (docsMissing.length && !mail.ok) {
      return NextResponse.json({
        success: false,
        contractSaved: true,
        emailSent: false,
        code: "ATTACHMENT_READ_FAILED",
        message:
          "Il contratto è stato salvato, ma uno o più allegati non sono disponibili.",
        details: docsMissing.map((d) => ({
          field: d.filename,
          message: "Contenuto non presente",
        })),
      });
    }

    return NextResponse.json({
      success: mail.ok,
      contractSaved: true,
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      emailSent: mail.ok,
      attachmentsInEmail: atts.length,
      documentsInDb: contract.documents.length,
      message: mail.ok
        ? atts.length
          ? `Contratto creato e inviato al Master (${atts.length} allegati in email; altri come link).`
          : "Contratto creato e inviato al Master (allegati come link protetti)."
        : "Il contratto è stato salvato, ma l'email non è stata inviata.",
      code: mail.ok ? "OK" : "EMAIL_SEND_FAILED",
      details: mail.ok
        ? undefined
        : [{ field: "email", message: mail.error ?? "Errore SMTP" }],
    });
  } catch (e) {
    console.error("[master email]", e);
    return NextResponse.json(
      {
        success: false,
        contractSaved: true,
        emailSent: false,
        code: "EMAIL_SEND_FAILED",
        message: "Il contratto è stato salvato, ma l'email non è stata inviata.",
      },
      { status: 500 },
    );
  }
}
