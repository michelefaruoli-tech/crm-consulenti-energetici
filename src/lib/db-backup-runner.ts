import "server-only";
import { prisma } from "@/lib/prisma";
import { getMasterEmail, sendMail, textToHtmlParagraphs } from "@/lib/mail";
import {
  buildFullDbExcelBuffer,
  countNewContractsToday,
} from "@/lib/db-backup-excel";
import { formatRomeDateTime, romeDateString, romeDayBounds } from "@/lib/timezone";

export type DbBackupResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  filename?: string;
  size?: number;
  newContractsToday?: number;
  reportDate?: string;
  counts?: Record<string, number>;
  emailed?: boolean;
  error?: string;
  /** Solo per download manuale */
  buffer?: Buffer;
};

function backupRecipient(): string {
  return (
    process.env.BACKUP_EMAIL?.trim() ||
    process.env.MASTER_EMAIL?.trim() ||
    getMasterEmail()
  );
}

async function alreadyEmailedToday(reportDate: string): Promise<boolean> {
  const { start, end } = romeDayBounds(reportDate);
  const existing = await prisma.backupLog.findFirst({
    where: {
      status: "EMAILED",
      createdAt: { gte: start, lte: end },
    },
    orderBy: { createdAt: "desc" },
  });
  return Boolean(existing);
}

/**
 * Backup Excel completo + email.
 * - Cron automatico: solo se ci sono nuovi contratti oggi e non già inviato.
 * - Manuale: sempre genera il file; email se sendEmail=true.
 */
export async function runDbExcelBackup(opts: {
  mode: "cron" | "manual";
  force?: boolean;
  sendEmail?: boolean;
  includeBuffer?: boolean;
}): Promise<DbBackupResult> {
  const reportDate = romeDateString();
  const { count: newContractsToday } = await countNewContractsToday(reportDate);

  if (opts.mode === "cron" && !opts.force) {
    if (newContractsToday === 0) {
      await prisma.backupLog.create({
        data: {
          filename: `skip-${reportDate}-no-new.xlsx`,
          size: 0,
          status: "SKIPPED_NO_NEW",
        },
      });
      return {
        ok: true,
        skipped: true,
        reason: "no_new_contracts",
        newContractsToday: 0,
        reportDate,
      };
    }
    if (await alreadyEmailedToday(reportDate)) {
      return {
        ok: true,
        skipped: true,
        reason: "already_emailed_today",
        newContractsToday,
        reportDate,
      };
    }
  }

  const excel = await buildFullDbExcelBuffer();
  const wantEmail = opts.mode === "cron" ? true : Boolean(opts.sendEmail);
  let emailed = false;
  let mailError: string | undefined;

  if (wantEmail) {
    const to = backupRecipient();
    const lines = [
      `Backup automatico database CRM – ${reportDate}`,
      `Generato: ${formatRomeDateTime(new Date())}`,
      "",
      `Nuovi contratti oggi: ${newContractsToday}`,
      `Clienti: ${excel.counts.clients}`,
      `Contratti totali nel file: ${excel.counts.contracts}`,
      `Provvigioni: ${excel.counts.commissions}`,
      `Ricorrenze: ${excel.counts.recurringMonths}`,
      `Fornitori: ${excel.counts.suppliers}`,
      `Storico stati: ${excel.counts.statusHistory}`,
      "",
      "In allegato trovi l'Excel COMPLETO diviso per fogli/categorie:",
      "00 Indice · 01 Clienti · 02 Contratti · 03 Provvigioni · 04 Ricorrenze",
      "05 Fornitori · 06 Servizi · 07 Listino · 08 Utenti · 09 Storico stati · 10 Allegati",
      "",
      "Nel foglio Contratti trovi: data inserimento, ingresso fornitura, date pagamento,",
      "se è pagato, gettoni, anagrafica cliente collegata.",
      "Nel foglio Clienti trovi TUTTI i dati anagrafici (non si perdono).",
      "",
      "Nota: le password utenti e i file binari (foto/PDF) non sono nell'Excel;",
      "l'elenco allegati è nel foglio 10 (solo nomi).",
    ];
    const body = lines.join("\n");
    const mail = await sendMail({
      to,
      subject: `Backup CRM ${reportDate} – ${excel.counts.contracts} contratti${
        newContractsToday > 0 ? ` (+${newContractsToday} oggi)` : ""
      }`,
      text: body,
      html: textToHtmlParagraphs(body),
      attachments: [
        {
          filename: excel.filename,
          content: excel.buffer,
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      ],
    });

    if (mail.ok) {
      emailed = true;
      await prisma.backupLog.create({
        data: {
          filename: excel.filename,
          size: excel.buffer.length,
          status: "EMAILED",
        },
      });
    } else {
      mailError = mail.error ?? "Invio email fallito";
      await prisma.backupLog.create({
        data: {
          filename: excel.filename,
          size: excel.buffer.length,
          status: mail.skipped ? "SKIPPED_NO_SMTP" : "ERROR",
        },
      });
    }
  } else {
    await prisma.backupLog.create({
      data: {
        filename: excel.filename,
        size: excel.buffer.length,
        status: "DOWNLOADED",
      },
    });
  }

  const ok = wantEmail ? emailed : true;

  return {
    ok,
    filename: excel.filename,
    size: excel.buffer.length,
    newContractsToday,
    reportDate,
    counts: excel.counts,
    emailed,
    error: mailError,
    buffer: opts.includeBuffer ? excel.buffer : undefined,
  };
}
