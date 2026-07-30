import "server-only";
import type { ContractStatus } from "@/generated/prisma/client";
import { CONTRACT_STATUS_LABELS, type AppContractStatus } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { sendMail, textToHtmlParagraphs } from "@/lib/mail";
import { clientDisplayName } from "@/lib/utils";
import { formatRomeDateTime } from "@/lib/timezone";

/** Stati Master per cui avvisare l’agente (da In lavorazione). */
const NOTIFY_TO: ContractStatus[] = [
  "IN_ATTESA_PAGAMENTO",
  "DOCUMENTAZIONE_INCOMPLETA",
  "KO",
];

export function shouldNotifyAgentStatusChange(
  from: ContractStatus | string,
  to: ContractStatus | string,
): boolean {
  return from === "IN_LAVORAZIONE" && NOTIFY_TO.includes(to as ContractStatus);
}

function statusLabel(status: string): string {
  return (
    CONTRACT_STATUS_LABELS[status as AppContractStatus] ?? status.replace(/_/g, " ")
  );
}

/**
 * Email all’agente/collaboratore quando Admin/Backoffice cambia lo stato
 * da In lavorazione → In pagamento / Richiesta integrazione / KO.
 * Non blocca il flusso se SMTP fallisce.
 */
export async function notifyCollaboratorStatusChange(opts: {
  contractId: string;
  fromStatus: ContractStatus | string;
  toStatus: ContractStatus | string;
  changedByName: string;
  note?: string | null;
  /** Note integrazione / KO da mostrare all’agente */
  detailNotes?: string | null;
}): Promise<{ sent: boolean; skipped?: boolean; error?: string }> {
  if (!shouldNotifyAgentStatusChange(opts.fromStatus, opts.toStatus)) {
    return { sent: false, skipped: true };
  }

  try {
    const contract = await prisma.contract.findUnique({
      where: { id: opts.contractId },
      select: {
        id: true,
        contractNumber: true,
        podPdr: true,
        pod: true,
        pdr: true,
        utilityType: true,
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

    const fromLabel = statusLabel(opts.fromStatus);
    const toLabel = statusLabel(opts.toStatus);
    const cliente = clientDisplayName(contract.client);
    const pod = contract.podPdr || contract.pod || contract.pdr || "—";
    const fornitore = contract.supplier?.name ?? "—";
    const when = formatRomeDateTime(new Date());

    const subject = `Aggiornamento pratica ${contract.contractNumber} – ${toLabel}`;

    const lines = [
      `Ciao ${contract.collaborator.name},`,
      "",
      `Lo stato di una tua pratica è stato aggiornato da ${opts.changedByName}.`,
      "",
      `Contratto: ${contract.contractNumber}`,
      `Cliente: ${cliente}`,
      `Fornitore: ${fornitore}`,
      `Servizio: ${contract.utilityType || "—"}`,
      `POD/PDR: ${pod}`,
      "",
      `Stato precedente: ${fromLabel}`,
      `Nuovo stato: ${toLabel}`,
      `Data/ora: ${when}`,
    ];

    if (opts.detailNotes?.trim()) {
      lines.push("", `Note: ${opts.detailNotes.trim()}`);
    } else if (opts.note?.trim()) {
      lines.push("", `Nota: ${opts.note.trim()}`);
    }

    if (opts.toStatus === "DOCUMENTAZIONE_INCOMPLETA") {
      lines.push(
        "",
        "È richiesta un’integrazione documentale. Entra nel CRM e completa quanto indicato.",
      );
    } else if (opts.toStatus === "IN_ATTESA_PAGAMENTO") {
      lines.push(
        "",
        "La pratica è in pagamento: il fornitore risulta in fase di liquidazione della provvigione.",
      );
    } else if (opts.toStatus === "KO") {
      lines.push("", "La pratica è stata chiusa come KO.");
    }

    lines.push("", "—", "CRM FM Consulenza (messaggio automatico)");

    const text = lines.join("\n");
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

    return { sent: true };
  } catch (e) {
    console.error("[notifyCollaboratorStatusChange]", e);
    return {
      sent: false,
      error: e instanceof Error ? e.message : "errore_email",
    };
  }
}
