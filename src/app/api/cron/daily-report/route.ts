import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getMasterEmail, sendMail, textToHtmlParagraphs } from "@/lib/mail";
import { romeDayBounds, formatRomeDateTime, romeDateString } from "@/lib/timezone";
import { CONTRACT_STATUS_LABELS } from "@/lib/constants";
import { clientDisplayName } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { start, end, reportDate } = romeDayBounds();
  const recipient = getMasterEmail();

  const existing = await prisma.dailyContractReport.findUnique({
    where: { reportDate_recipient: { reportDate, recipient } },
  });
  if (existing?.status === "SENT") {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "already_sent",
      reportDate,
      contractsCount: existing.contractsCount,
    });
  }

  const changes = await prisma.contractStatusHistory.findMany({
    where: {
      changedAt: { gte: start, lte: end },
      contract: {
        deletedAt: null,
        OR: [{ sendToMaster: true }, { assignedToMaster: true }],
      },
    },
    include: {
      contract: {
        include: {
          client: true,
          collaborator: { select: { name: true } },
          supplier: { select: { name: true } },
        },
      },
      changedBy: { select: { name: true } },
    },
    orderBy: { changedAt: "asc" },
  });

  if (changes.length === 0) {
    await prisma.dailyContractReport.upsert({
      where: { reportDate_recipient: { reportDate, recipient } },
      create: {
        reportDate,
        recipient,
        contractsCount: 0,
        status: "EMPTY_SKIPPED",
        attempts: 1,
        sentAt: new Date(),
      },
      update: {
        contractsCount: 0,
        status: "EMPTY_SKIPPED",
        attempts: { increment: 1 },
        sentAt: new Date(),
        lastError: null,
      },
    });
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "no_changes",
      reportDate,
    });
  }

  const counts = {
    total: changes.length,
    IN_LAVORAZIONE: 0,
    IN_ATTESA_PAGAMENTO: 0,
    ATTIVATO: 0,
    KO: 0,
  };
  for (const c of changes) {
    if (c.toStatus in counts) {
      counts[c.toStatus as keyof typeof counts] =
        (counts[c.toStatus as keyof typeof counts] as number) + 1;
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://crm.fmconsulenza.it";
  const lines = [
    `Riepilogo giornaliero contratti – ${reportDate}`,
    `Fuso: Europe/Rome · Generato: ${formatRomeDateTime(new Date())}`,
    "",
    `Totale modifiche: ${counts.total}`,
    `→ In lavorazione: ${counts.IN_LAVORAZIONE}`,
    `→ In attesa di pagamento: ${counts.IN_ATTESA_PAGAMENTO}`,
    `→ Attivato: ${counts.ATTIVATO}`,
    `→ KO: ${counts.KO}`,
    "",
    "Dettaglio:",
  ];

  for (const c of changes) {
    lines.push(
      [
        `- ${c.contract.contractNumber} | ${clientDisplayName(c.contract.client)}`,
        `  Collaboratore: ${c.contract.collaborator.name}`,
        `  ${c.fromStatus ? CONTRACT_STATUS_LABELS[c.fromStatus] ?? c.fromStatus : "—"} → ${CONTRACT_STATUS_LABELS[c.toStatus] ?? c.toStatus}`,
        `  ${formatRomeDateTime(c.changedAt)} · ${c.changedBy.name}`,
        c.note ? `  Note: ${c.note}` : null,
        c.koReason ? `  KO: ${c.koReason}` : null,
        c.expectedPaymentAmount != null
          ? `  Importo atteso: ${c.expectedPaymentAmount}`
          : null,
        c.activationDate
          ? `  Attivazione: ${formatRomeDateTime(c.activationDate)}`
          : null,
        `  Link: ${appUrl}/lavorazione/${c.contractId}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  const body = lines.join("\n");
  const subject = `Riepilogo giornaliero contratti – ${reportDate} – ${counts.total} modifiche`;

  const mail = await sendMail({
    to: recipient,
    subject,
    text: body,
    html: textToHtmlParagraphs(body),
  });

  const status = mail.ok ? "SENT" : mail.skipped ? "SKIPPED_NO_SMTP" : "ERROR";
  await prisma.dailyContractReport.upsert({
    where: { reportDate_recipient: { reportDate, recipient } },
    create: {
      reportDate,
      recipient,
      contractsCount: counts.total,
      status,
      messageId: mail.messageId,
      attempts: 1,
      lastError: mail.error,
      payloadSummary: createHash("sha256").update(body).digest("hex"),
      sentAt: mail.ok ? new Date() : null,
    },
    update: {
      contractsCount: counts.total,
      status,
      messageId: mail.messageId,
      attempts: { increment: 1 },
      lastError: mail.error ?? null,
      payloadSummary: createHash("sha256").update(body).digest("hex"),
      sentAt: mail.ok ? new Date() : null,
    },
  });

  return NextResponse.json({
    ok: mail.ok,
    reportDate: romeDateString(),
    contractsCount: counts.total,
    status,
    error: mail.error,
  });
}
