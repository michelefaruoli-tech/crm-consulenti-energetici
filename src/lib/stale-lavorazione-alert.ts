import "server-only";
import { prisma } from "@/lib/prisma";
import { sendMail, textToHtmlParagraphs } from "@/lib/mail";
import {
  formatEmailList,
  getLavorazioneNotifyEmails,
} from "@/lib/user-scope";
import { clientDisplayName } from "@/lib/utils";
import { operationTypeLabel } from "@/lib/provvigioni-stato";
import { formatRomeDateTime } from "@/lib/timezone";

export const STALE_LAVORAZIONE_HOURS = 48;
export const STALE_LAVORAZIONE_EMAIL_TYPE = "STALE_LAVORAZIONE_48H";

function hoursSince(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / (60 * 60 * 1000)));
}

function serviceLabel(utilityType: string | null | undefined): string {
  const v = (utilityType ?? "").trim().toUpperCase();
  if (v === "LUCE") return "Luce";
  if (v === "GAS") return "Gas";
  if (v === "DUAL") return "Luce + Gas";
  if (v === "ALTRO") return "Altro";
  return utilityType?.trim() || "—";
}

function cteToUse(opts: {
  commissionRuleName?: string | null;
  offerCode?: string | null;
  productName?: string | null;
}): string {
  return (
    opts.commissionRuleName?.trim() ||
    opts.offerCode?.trim() ||
    opts.productName?.trim() ||
    "—"
  );
}

function payloadHash(contractId: string, since: Date): string {
  return `stale48h:${contractId}:${since.getTime()}`;
}

/**
 * Contratti In lavorazione da più di 48 ore: email urgente al Master
 * (e Back Office del fornitore). Un solo invio per ogni ingresso in coda.
 */
export async function sendStaleLavorazioneAlerts(opts?: {
  now?: Date;
}): Promise<{
  checked: number;
  sent: number;
  skipped: number;
  errors: number;
}> {
  const now = opts?.now ?? new Date();
  const cutoff = new Date(now.getTime() - STALE_LAVORAZIONE_HOURS * 60 * 60 * 1000);

  const contracts = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      isHistorical: false,
      sendToMaster: true,
      assignedToMaster: true,
      status: "IN_LAVORAZIONE",
      OR: [
        { sentToMasterAt: { lte: cutoff } },
        {
          AND: [{ sentToMasterAt: null }, { insertionDate: { lte: cutoff } }],
        },
      ],
    },
    select: {
      id: true,
      contractNumber: true,
      sentToMasterAt: true,
      insertionDate: true,
      utilityType: true,
      operationType: true,
      offerCode: true,
      productName: true,
      pod: true,
      pdr: true,
      podPdr: true,
      supplierId: true,
      supplier: { select: { name: true } },
      collaborator: { select: { name: true } },
      commissionRule: { select: { name: true } },
      client: {
        select: {
          type: true,
          firstName: true,
          lastName: true,
          companyName: true,
        },
      },
    },
    orderBy: [{ sentToMasterAt: "asc" }, { insertionDate: "asc" }],
    take: 80,
  });

  const result = { checked: contracts.length, sent: 0, skipped: 0, errors: 0 };
  if (contracts.length === 0) return result;

  const hashes = contracts.map((c) =>
    payloadHash(c.id, c.sentToMasterAt ?? c.insertionDate),
  );
  const alreadySent = await prisma.contractEmailLog.findMany({
    where: {
      emailType: STALE_LAVORAZIONE_EMAIL_TYPE,
      payloadHash: { in: hashes },
      status: "SENT",
    },
    select: { payloadHash: true },
  });
  const sentHashes = new Set(
    alreadySent.map((l) => l.payloadHash).filter((h): h is string => Boolean(h)),
  );

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://crm.fmconsulenza.it";

  for (const contract of contracts) {
    const since = contract.sentToMasterAt ?? contract.insertionDate;
    const hash = payloadHash(contract.id, since);
    if (sentHashes.has(hash)) {
      result.skipped += 1;
      continue;
    }

    const cliente = clientDisplayName(contract.client);
    const fornitore = contract.supplier.name.trim();
    const collaboratore = contract.collaborator.name.trim();
    const ore = hoursSince(since, now);
    const operazione = operationTypeLabel(contract.operationType);
    const servizio = serviceLabel(contract.utilityType);
    const cte = cteToUse({
      commissionRuleName: contract.commissionRule?.name,
      offerCode: contract.offerCode,
      productName: contract.productName,
    });
    const pod = contract.podPdr || contract.pod || contract.pdr || "—";

    const subject = ["URGENTE LAVORAZIONE", cliente, fornitore, collaboratore]
      .filter(Boolean)
      .join(" ");

    const notes = [
      `Tipo contratto: ${operazione}`,
      `Servizio: ${servizio}`,
      `Fornitore: ${fornitore}`,
      `CTE da usare: ${cte}`,
    ].join("\n");

    const body = [
      "Pratica in lavorazione da oltre 48 ore.",
      "",
      notes,
      "",
      `Collaboratore: ${collaboratore}`,
      `Cliente: ${cliente}`,
      `Contratto: ${contract.contractNumber}`,
      `POD/PDR: ${pod}`,
      `In coda da: ${formatRomeDateTime(since)} (${ore} ore)`,
      `Scheda: ${appUrl}/lavorazione/${contract.id}`,
    ].join("\n");

    const recipients = await getLavorazioneNotifyEmails(contract.supplierId);
    const toEmail = formatEmailList(recipients);
    const mail = await sendMail({
      to: recipients,
      subject,
      text: body,
      html: textToHtmlParagraphs(body),
    });

    await prisma.contractEmailLog.create({
      data: {
        contractId: contract.id,
        toEmail,
        subject,
        status: mail.ok ? "SENT" : mail.skipped ? "SKIPPED_NO_SMTP" : "ERROR",
        emailType: STALE_LAVORAZIONE_EMAIL_TYPE,
        error: mail.error ?? null,
        messageId: mail.messageId,
        payloadHash: hash,
        sentAt: mail.ok ? now : null,
      },
    });

    if (mail.ok) {
      result.sent += 1;
      sentHashes.add(hash);
    } else {
      result.errors += 1;
      console.error(
        "[staleLavorazioneAlert]",
        contract.contractNumber,
        mail.error,
      );
    }
  }

  return result;
}
