import "server-only";
import type { ContractStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { sendMail, textToHtmlParagraphs } from "@/lib/mail";
import { clientDisplayName } from "@/lib/utils";
import { resolveContractStakeholderEmails } from "@/lib/backoffice-destination";
import { formatEmailList } from "@/lib/user-scope";
import {
  createAppNotificationsForUsers,
  resolveActiveUserIdsByEmails,
} from "@/lib/app-notifications";

/** Stati Master per cui avvisare Master + inseritore/collaboratore. */
const NOTIFY_TO: ContractStatus[] = [
  "IN_ATTESA_PAGAMENTO",
  "DOCUMENTAZIONE_INCOMPLETA",
  "KO",
];

const STATUS_OUTCOME_LABEL: Partial<Record<ContractStatus, string>> = {
  IN_ATTESA_PAGAMENTO: "Conclusa — in attesa di pagamento",
  DOCUMENTAZIONE_INCOMPLETA: "Richiesta integrazione documenti",
  KO: "Pratica KO",
};

export function shouldNotifyAgentStatusChange(
  from: ContractStatus | string,
  to: ContractStatus | string,
): boolean {
  if (from === to) return false;
  return NOTIFY_TO.includes(to as ContractStatus);
}

async function createInAppOutcomeNotifications(opts: {
  contractId: string;
  contractNumber: string;
  cliente: string;
  fornitore: string;
  outcomeLabel: string;
  agentNotes: string;
  recipientEmails: string[];
}): Promise<void> {
  try {
    const userIds = await resolveActiveUserIdsByEmails(opts.recipientEmails);
    if (userIds.length === 0) return;
    const title = `${opts.outcomeLabel} — ${opts.cliente}`;
    const bodyParts = [
      opts.fornitore ? `Fornitore: ${opts.fornitore}` : null,
      `Contratto: ${opts.contractNumber}`,
      opts.agentNotes ? opts.agentNotes.slice(0, 400) : null,
    ].filter(Boolean);
    await createAppNotificationsForUsers(userIds, {
      type: "CONTRACT_OUTCOME",
      title,
      body: bodyParts.join(" · "),
      link: `/contratti/${opts.contractId}`,
    });
  } catch (e) {
    console.warn("[notifyCollaboratorStatusChange] in-app", e);
  }
}

/**
 * Email a Master + inseritore/collaboratore quando Back Office completa / risponde.
 * Destinatari: sempre MASTER_EMAIL e email di chi ha inserito (+ collaboratore se diverso).
 * In parallelo crea notifiche in-app (campana) per gli stessi destinatari.
 * Non blocca il flusso se SMTP fallisce.
 */
export async function notifyCollaboratorStatusChange(opts: {
  contractId: string;
  fromStatus: ContractStatus | string;
  toStatus: ContractStatus | string;
  changedByName: string;
  note?: string | null;
  /** Note integrazione / KO / istruzioni per l’agente */
  detailNotes?: string | null;
}): Promise<{ sent: boolean; skipped?: boolean; error?: string }> {
  if (!shouldNotifyAgentStatusChange(opts.fromStatus, opts.toStatus)) {
    return { sent: false, skipped: true };
  }

  const agentNotes = (opts.detailNotes ?? opts.note ?? "").trim();
  if (!agentNotes) {
    console.warn(
      "[notifyCollaboratorStatusChange] cambio stato senza note — email non inviata",
      opts.contractId,
    );
    return { sent: false, skipped: true, error: "note_mancanti" };
  }

  try {
    const contract = await prisma.contract.findUnique({
      where: { id: opts.contractId },
      select: {
        id: true,
        contractNumber: true,
        collaboratorId: true,
        createdById: true,
        supplier: { select: { name: true } },
        client: {
          select: {
            type: true,
            firstName: true,
            lastName: true,
            companyName: true,
          },
        },
      },
    });

    if (!contract) return { sent: false, error: "contratto_non_trovato" };

    const stakeholders = await resolveContractStakeholderEmails({
      collaboratorId: contract.collaboratorId,
      createdById: contract.createdById,
    });
    const recipients = stakeholders.recipients;
    if (recipients.length === 0) {
      console.warn(
        "[notifyCollaboratorStatusChange] nessun destinatario (Master/inseritore)",
        contract.contractNumber,
      );
      return { sent: false, skipped: true, error: "nessun_destinatario" };
    }

    const cliente = clientDisplayName(contract.client);
    const fornitore = (contract.supplier?.name ?? "").trim();
    const outcomeLabel =
      STATUS_OUTCOME_LABEL[opts.toStatus as ContractStatus] ??
      String(opts.toStatus);
    const subject =
      [
        "Esito lavorazione Back Office",
        cliente,
        fornitore || null,
      ]
        .filter(Boolean)
        .join(" – ") || `Esito lavorazione – ${cliente}`;

    const text = [
      "Esito lavorazione Back Office",
      "",
      `Cliente: ${cliente}`,
      fornitore ? `Fornitore: ${fornitore}` : null,
      `Contratto: ${contract.contractNumber}`,
      `Esito: ${outcomeLabel}`,
      `Aggiornato da: ${opts.changedByName}`,
      "",
      "Note / istruzioni:",
      agentNotes,
    ]
      .filter((line): line is string => line != null)
      .join("\n");

    // Notifica in-app (aggiuntiva alle email BO #66)
    await createInAppOutcomeNotifications({
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      cliente,
      fornitore,
      outcomeLabel,
      agentNotes,
      recipientEmails: recipients,
    });

    const toEmail = formatEmailList(recipients);
    const result = await sendMail({
      to: recipients,
      subject,
      text,
      html: textToHtmlParagraphs(text),
    });

    if (!result.ok) {
      console.error(
        "[notifyCollaboratorStatusChange] SMTP",
        contract.contractNumber,
        result.error,
      );
      return { sent: false, skipped: result.skipped, error: result.error };
    }

    await prisma.contractEmailLog
      .create({
        data: {
          contractId: contract.id,
          toEmail,
          subject,
          status: "SENT",
          emailType: "AGENT_STATUS_NOTES",
          messageId: result.messageId,
          sentById: null,
          sentAt: new Date(),
        },
      })
      .catch((e) => {
        console.warn("[notifyCollaboratorStatusChange] log email", e);
      });

    return { sent: true };
  } catch (e) {
    console.error("[notifyCollaboratorStatusChange]", e);
    return {
      sent: false,
      error: e instanceof Error ? e.message : "errore_email",
    };
  }
}
