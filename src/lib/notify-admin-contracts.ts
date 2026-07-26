import "server-only";
import { prisma } from "@/lib/prisma";
import { getMasterEmail, sendMail, textToHtmlParagraphs } from "@/lib/mail";
import { clientDisplayName } from "@/lib/utils";
import { formatRomeDateTime } from "@/lib/timezone";

function adminNotifyEmail(): string {
  return (
    process.env.BACKUP_EMAIL?.trim() ||
    process.env.MASTER_EMAIL?.trim() ||
    getMasterEmail()
  );
}

/**
 * Avviso email a te ogni volta che vengono creati/caricati nuovi contratti.
 * Non blocca il salvataggio se SMTP fallisce.
 */
export async function notifyAdminNewContracts(opts: {
  source: "nuovo_contratto" | "import_archivio" | "altro";
  contractIds: string[];
  byUserName: string;
  note?: string;
}): Promise<void> {
  if (!opts.contractIds.length) return;

  try {
    const contracts = await prisma.contract.findMany({
      where: { id: { in: opts.contractIds } },
      select: {
        id: true,
        contractNumber: true,
        podPdr: true,
        pod: true,
        pdr: true,
        status: true,
        paymentStatus: true,
        collectionDate: true,
        insertionDate: true,
        client: {
          select: {
            type: true,
            firstName: true,
            lastName: true,
            companyName: true,
          },
        },
        supplier: { select: { name: true } },
        collaborator: { select: { name: true } },
        commission: { select: { expected: true } },
      },
      take: 50,
    });

    if (!contracts.length) return;

    const lines = [
      `Nuovi contratti caricati nel CRM`,
      `Quando: ${formatRomeDateTime(new Date())}`,
      `Origine: ${opts.source}`,
      `Operatore: ${opts.byUserName}`,
      opts.note ? `Nota: ${opts.note}` : "",
      `Totale in questo avviso: ${contracts.length}`,
      "",
      ...contracts.map((c, i) => {
        const pod = c.podPdr || c.pod || c.pdr || "—";
        const paid = c.collectionDate ? "Incassato" : c.paymentStatus || "Da incassare";
        const gettone =
          c.commission?.expected != null
            ? `${Number(c.commission.expected)} €`
            : "—";
        return [
          `${i + 1}. ${clientDisplayName(c.client)}`,
          `   N. ${c.contractNumber} · ${c.supplier.name} · POD ${pod}`,
          `   Collab. ${c.collaborator.name} · ${paid} · gettone ${gettone}`,
        ].join("\n");
      }),
      "",
      "Backup completo Excel: Report → Backup, oppure automatico ogni sera.",
    ].filter(Boolean);

    const body = lines.join("\n");
    await sendMail({
      to: adminNotifyEmail(),
      subject: `CRM · ${contracts.length} nuov${contracts.length === 1 ? "o contratto" : "i contratti"} (${opts.source})`,
      text: body,
      html: textToHtmlParagraphs(body),
    });
  } catch (e) {
    console.error("[notifyAdminNewContracts]", e);
  }
}
