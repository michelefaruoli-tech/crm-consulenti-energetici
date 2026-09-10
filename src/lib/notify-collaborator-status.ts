import "server-only";
import type { ContractStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { sendMail, textToHtmlParagraphs } from "@/lib/mail";
import { clientDisplayName } from "@/lib/utils";

/** Stati Master per cui avvisare l’agente. */
const NOTIFY_TO: ContractStatus[] = [
  "IN_ATTESA_PAGAMENTO",
  "DOCUMENTAZIONE_INCOMPLETA",
  "KO",
];

export function shouldNotifyAgentStatusChange(
  from: ContractStatus | string,
  to: ContractStatus | string,
): boolean {
  if (from === to) return false;
  return NOTIFY_TO.includes(to as ContractStatus);
}

/**
 * Email all’agente quando Back Office/Admin cambia lo stato.
 * Oggetto: Nome Cognome Fornitore
 * Corpo: solo le note (cosa deve fare l’agente).
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
        supplier: { select: { name: true } },
        client: {
          select: {
            type: true,
            firstName: true,
            lastName: true,
            companyName: true,
          },
        },
        collaborator: {
          select: { id: true, name: true, email: true, active: true },
        },
      },
    });

    if (!contract) return { sent: false, error: "contratto_non_trovato" };

    const to = contract.collaborator.email?.trim();
    if (!to || !contract.collaborator.active) {
      console.warn(
        "[notifyCollaboratorStatusChange] agente senza email o inattivo",
        contract.contractNumber,
      );
      return { sent: false, skipped: true, error: "agente_senza_email" };
    }

    const cliente = clientDisplayName(contract.client);
    const fornitore = (contract.supplier?.name ?? "").trim();
    const subject = [cliente, fornitore].filter(Boolean).join(" ").trim() || cliente;

    const text = agentNotes;
    const result = await sendMail({
      to,
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

    await prisma.contractEmailLog.create({
      data: {
        contractId: contract.id,
        toEmail: to,
        subject,
        status: "SENT",
        emailType: "AGENT_STATUS_NOTES",
        messageId: result.messageId,
        sentById: null,
        sentAt: new Date(),
      },
    }).catch((e) => {
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
