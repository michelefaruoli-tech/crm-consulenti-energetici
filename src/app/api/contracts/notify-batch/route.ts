import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sendMail, textToHtmlParagraphs } from "@/lib/mail";
import {
  formatEmailList,
  getLavorazioneNotifyEmails,
} from "@/lib/user-scope";
import { buildBatchContractNotificationBody } from "@/lib/contract-notification-email";
import {
  attachmentConfig,
  emailInlineMaxBytes,
} from "@/lib/attachment-config";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Invio email UNICA per più contratti creati insieme (Luce + Gas…).
 * Body: anagrafica + blocco per ogni servizio + allegati.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, message: "Non autenticato" }, { status: 401 });
    }
    if (!hasPermission(session.role, "contracts.create")) {
      return NextResponse.json({ success: false, message: "Permesso negato" }, { status: 403 });
    }

    const bodyJson = (await request.json().catch(() => null)) as {
      contractIds?: string[];
    } | null;
    const contractIds = [
      ...new Set((bodyJson?.contractIds ?? []).map((s) => String(s).trim()).filter(Boolean)),
    ].slice(0, 20);

    if (contractIds.length === 0) {
      return NextResponse.json(
        { success: false, emailSent: false, message: "Nessun contratto da notificare" },
        { status: 400 },
      );
    }

    let contracts = await prisma.contract.findMany({
      where: { id: { in: contractIds }, deletedAt: null },
      include: {
        client: true,
        supplier: true,
        collaborator: true,
        documents: {
          where: { deletedAt: null },
          orderBy: { uploadedAt: "desc" },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Mantieni ordine richiesto dal client
    contracts = contractIds
      .map((id) => contracts.find((c) => c.id === id))
      .filter(Boolean) as typeof contracts;

    if (contracts.length === 0) {
      return NextResponse.json(
        { success: false, emailSent: false, message: "Contratti non trovati" },
        { status: 404 },
      );
    }

    // Copia allegati dal contratto più ricco agli altri senza documenti (evita perdita Luce/Gas)
    const richest = [...contracts].sort(
      (a, b) =>
        b.documents.filter((d) => d.contentBase64).length -
        a.documents.filter((d) => d.contentBase64).length,
    )[0]!;
    const sourceDocs = richest.documents.filter((d) => d.contentBase64);
    if (sourceDocs.length > 0) {
      for (const c of contracts) {
        if (c.id === richest.id) continue;
        if (c.documents.some((d) => d.contentBase64)) continue;
        for (const d of sourceDocs) {
          await prisma.document.create({
            data: {
              contractId: c.id,
              clientId: c.clientId,
              filename: d.filename,
              mimeType: d.mimeType || "application/octet-stream",
              size: d.size,
              path: `db://clone-${c.id}-${Date.now()}`,
              docType: d.docType,
              contentBase64: d.contentBase64,
              storageProvider: "postgres_base64",
              uploadedById: session.id,
            },
          });
        }
      }
      // Ricarica documenti aggiornati
      contracts = await prisma.contract.findMany({
        where: { id: { in: contracts.map((c) => c.id) } },
        include: {
          client: true,
          supplier: true,
          collaborator: true,
          documents: {
            where: { deletedAt: null },
            orderBy: { uploadedAt: "desc" },
          },
        },
        orderBy: { createdAt: "asc" },
      });
      contracts = contractIds
        .map((id) => contracts.find((c) => c.id === id))
        .filter(Boolean) as typeof contracts;
    }

    const recipientSet = new Set<string>();
    for (const c of contracts) {
      const list = await getLavorazioneNotifyEmails(c.supplierId);
      for (const e of list) recipientSet.add(e);
    }
    const recipients = [...recipientSet];
    const toEmail = formatEmailList(recipients);

    const { subject, body, docsWithContent } = buildBatchContractNotificationBody(contracts);

    const hash = createHash("sha256")
      .update(`batch:${contracts.map((c) => c.id).join(",")}:docs:${docsWithContent.length}:v1`)
      .digest("hex");

    const already = await prisma.contractEmailLog.findFirst({
      where: {
        contractId: contracts[0]!.id,
        payloadHash: hash,
        status: "SENT",
      },
    });
    if (already) {
      return NextResponse.json({
        success: true,
        emailSent: true,
        message: "Email batch già inviata",
        contractIds: contracts.map((c) => c.id),
        recipients: toEmail,
      });
    }

    const atts: { filename: string; content: Buffer; contentType?: string }[] = [];
    let bytes = 0;
    const inlineLimit = emailInlineMaxBytes();
    for (const d of docsWithContent) {
      try {
        const buf = Buffer.from(d.contentBase64!, "base64");
        if (buf.length === 0) continue;
        if (bytes + buf.length > inlineLimit) continue;
        bytes += buf.length;
        atts.push({
          filename: d.filename,
          content: buf,
          contentType: d.mimeType || "application/octet-stream",
        });
      } catch {
        // salta
      }
    }

    const attemptAt = new Date();
    const mail = await sendMail({
      to: recipients,
      subject,
      text: body,
      html: textToHtmlParagraphs(body),
      attachments: atts,
    });

    for (const c of contracts) {
      await prisma.contractEmailLog.create({
        data: {
          contractId: c.id,
          toEmail,
          subject,
          status: mail.ok ? "SENT" : mail.skipped ? "SKIPPED_NO_SMTP" : "ERROR",
          emailType: contracts.length > 1 ? "MASTER_BATCH" : "MASTER_NEW",
          error: mail.ok ? null : mail.error ?? null,
          messageId: mail.messageId,
          sentById: session.id,
          payloadHash: hash,
          sentAt: mail.ok ? attemptAt : null,
        },
      });
      await prisma.contract.update({
        where: { id: c.id },
        data: {
          emailStatus: mail.ok ? "SENT" : mail.skipped ? "FAILED" : "FAILED",
          emailLastError: mail.ok ? null : mail.error ?? "Invio non riuscito",
          emailMessageId: mail.messageId ?? undefined,
          emailAttempts: { increment: 1 },
          emailLastAttemptAt: attemptAt,
          emailIdempotencyKey: hash,
          sentToMasterAt: mail.ok ? attemptAt : undefined,
          workEmailDate: mail.ok ? attemptAt : undefined,
          masterEmail: recipients[0] ?? undefined,
        },
      });
    }

    if (mail.ok && attachmentConfig.deleteAfterEmail) {
      for (const c of contracts) {
        const toClear = c.documents.filter((d) => d.contentBase64);
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
      }
      await writeAuditLog({
        userId: session.id,
        action: "CLEAR_ATTACHMENT_CONTENT",
        entity: "Contract",
        entityId: contracts[0]!.id,
        details: { count: contracts.length, reason: "after_batch_email" },
      });
    }

    return NextResponse.json({
      success: mail.ok,
      emailSent: mail.ok,
      contractIds: contracts.map((c) => c.id),
      contractCount: contracts.length,
      recipients: toEmail,
      attachmentsInEmail: atts.length,
      message: mail.ok
        ? contracts.length > 1
          ? `Email unica inviata a ${toEmail} con ${contracts.length} contratti (anagrafica + blocchi servizio + allegati).`
          : `Contratto inviato a ${toEmail}.`
        : mail.error || "Invio email non riuscito",
      code: mail.ok ? "OK" : "EMAIL_SEND_FAILED",
    });
  } catch (e) {
    console.error("[notify-batch]", e);
    return NextResponse.json(
      {
        success: false,
        emailSent: false,
        message: "Errore durante l'invio email batch",
      },
      { status: 500 },
    );
  }
}
