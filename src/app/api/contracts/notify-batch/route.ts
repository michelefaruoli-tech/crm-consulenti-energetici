import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { requireApiSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sendMail, textToHtmlParagraphs } from "@/lib/mail";
import {
  formatEmailList,
  userCanAccessContract,
} from "@/lib/user-scope";
import {
  formatBackofficeDestinationMessage,
  mergeBackofficeAndStakeholderRecipients,
  resolveBackofficeDestination,
} from "@/lib/backoffice-destination";
import { buildBatchContractNotificationBody } from "@/lib/contract-notification-email";
import {
  attachmentConfig,
  emailInlineMaxBytes,
} from "@/lib/attachment-config";
import { writeAuditLog } from "@/lib/audit";
import { enqueueContractsForBackoffice } from "@/lib/enqueue-backoffice";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Invio email UNICA per più contratti creati insieme (Luce + Gas…).
 * Body: anagrafica + blocco per ogni servizio + allegati.
 *
 * Sempre: enqueue → IN_LAVORAZIONE + flag coda (anche senza BO dedicato).
 * L’assenza di destinatario BO “classico” (es. Serviren) non fa fallire
 * l’operazione: ritorna queued=true + warning esplicito.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession();
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
        { success: false, queued: false, emailSent: false, message: "Nessun contratto da notificare" },
        { status: 400 },
      );
    }

    let contracts = await prisma.contract.findMany({
      where: { id: { in: contractIds }, deletedAt: null },
      include: {
        client: true,
        supplier: true,
        collaborator: true,
        createdBy: { select: { id: true, email: true, name: true, active: true } },
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
        { success: false, queued: false, emailSent: false, message: "Contratti non trovati" },
        { status: 404 },
      );
    }

    for (const c of contracts) {
      if (!(await userCanAccessContract(session, c))) {
        return NextResponse.json(
          { success: false, queued: false, emailSent: false, message: "Permesso negato su uno dei contratti" },
          { status: 403 },
        );
      }
    }

    const enqueueResults = await enqueueContractsForBackoffice({
      contractIds: contracts.map((c) => c.id),
      userId: session.id,
    });
    const queuedCount = enqueueResults.filter((r) => r.queued).length;

    // Destinazione BO + Master + inseritore/collaboratore per ogni pratica
    const destBySupplier = new Map<
      string,
      Awaited<ReturnType<typeof resolveBackofficeDestination>>
    >();
    const recipientSet = new Set<string>();
    for (const c of contracts) {
      const sid = c.supplierId;
      const merged = await mergeBackofficeAndStakeholderRecipients({
        supplierId: sid,
        collaboratorId: c.collaboratorId,
        createdById: c.createdById,
      });
      if (!destBySupplier.has(sid)) {
        destBySupplier.set(sid, merged.destination);
      }
      for (const e of merged.recipients) recipientSet.add(e);
    }
    const destinations = [...destBySupplier.values()];
    const hasAnyDedicated = destinations.some((d) => d.hasDedicatedBo);
    const warnings = destinations
      .map((d) => d.warning)
      .filter((w): w is string => Boolean(w));
    const recipients = [...recipientSet];
    const toEmail = formatEmailList(recipients);
    const primaryDest = destinations[0]!;
    const boWarning =
      warnings.length > 0
        ? warnings.join(" ")
        : null;

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
          createdBy: { select: { id: true, email: true, name: true, active: true } },
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

    // Nessun destinatario email (admin non configurato e nessun BO): coda ok, no mail
    if (recipients.length === 0) {
      const message = formatBackofficeDestinationMessage(
        {
          ...primaryDest,
          recipients: [],
          warning:
            boWarning ||
            "Nessun destinatario email configurato (MASTER_EMAIL / Back Office). La pratica è comunque in coda In lavorazione.",
        },
        { queued: true, emailSent: false },
      );
      return NextResponse.json({
        success: true,
        queued: true,
        queuedCount,
        emailSent: false,
        contractIds: contracts.map((c) => c.id),
        contractCount: contracts.length,
        recipients: "",
        hasDedicatedBo: hasAnyDedicated,
        boWarning:
          boWarning ||
          "Nessun destinatario email configurato. Pratica in lavorazione senza notifica.",
        message,
        code: "QUEUED_NO_RECIPIENTS",
      });
    }

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
        queued: true,
        queuedCount,
        emailSent: true,
        message: boWarning
          ? `Email batch già inviata. ${boWarning}`
          : "Email batch già inviata",
        contractIds: contracts.map((c) => c.id),
        recipients: toEmail,
        hasDedicatedBo: hasAnyDedicated,
        boWarning,
        code: "OK_ALREADY_SENT",
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
          // sentToMasterAt già impostato da enqueue; aggiorna solo se email ok
          ...(mail.ok ? { sentToMasterAt: attemptAt, workEmailDate: attemptAt } : {}),
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

    const baseMsg = mail.ok
      ? contracts.length > 1
        ? `Email unica inviata a ${toEmail} con ${contracts.length} contratti.`
        : `Contratto inviato a ${toEmail}.`
      : mail.error || "Invio email non riuscito";

    const message = [
      "Pratiche in coda In lavorazione (IN_LAVORAZIONE).",
      baseMsg,
      boWarning,
    ]
      .filter(Boolean)
      .join(" ");

    return NextResponse.json({
      // success = coda ok (non dipende solo dall’email): evita «sparizione» silenziosa
      success: true,
      queued: true,
      queuedCount,
      emailSent: mail.ok,
      contractIds: contracts.map((c) => c.id),
      contractCount: contracts.length,
      recipients: toEmail,
      attachmentsInEmail: atts.length,
      hasDedicatedBo: hasAnyDedicated,
      boWarning,
      message,
      code: mail.ok
        ? hasAnyDedicated
          ? "OK"
          : "QUEUED_ADMIN_ONLY"
        : "QUEUED_EMAIL_FAILED",
    });
  } catch (e) {
    console.error("[notify-batch]", e);
    return NextResponse.json(
      {
        success: false,
        queued: false,
        emailSent: false,
        message: "Errore durante l'invio / messa in coda Back Office",
      },
      { status: 500 },
    );
  }
}
