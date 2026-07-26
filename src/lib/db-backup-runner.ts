import "server-only";
import { prisma } from "@/lib/prisma";
import { getMasterEmail, sendMail, textToHtmlParagraphs } from "@/lib/mail";
import {
  buildFullDbExcelBuffer,
  countNewContractsToday,
} from "@/lib/db-backup-excel";
import { buildFullDbJsonDump } from "@/lib/db-json-backup";
import { formatRomeDateTime, romeDateString, romeDayBounds } from "@/lib/timezone";

/** Limite allegato JSON via email (SMTP/Gmail ~25MB totali). */
const MAX_JSON_EMAIL_BYTES = 18 * 1024 * 1024;

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
  jsonFilename?: string;
  jsonIncludedInEmail?: boolean;
  gitHash?: string;
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
 * - Cron automatico: ogni sera (salta solo se già inviato oggi, salvo force).
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
      `Backup GIORNALIERO database CRM – ${reportDate}`,
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
      "se è pagato / da pagare, gettoni, anagrafica cliente collegata.",
      "Nel foglio Clienti trovi TUTTI i dati anagrafici (non si perdono).",
      "",
      "Nota: le password utenti e i file binari (foto/PDF) non sono nell'Excel;",
      "l'elenco allegati è nel foglio 10 (solo nomi).",
      "Il codice del sito resta su GitHub (ripristino versione = git checkout).",
    ];
    const body = lines.join("\n");
    const mail = await sendMail({
      to,
      subject: `Backup giornaliero CRM ${reportDate} – ${excel.counts.contracts} contratti${
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

/**
 * Snapshot «versione funzionante»: Excel dati + JSON completo → email.
 * Serve se qualcosa si rompe: hai i dati e il riferimento alla versione codice (git).
 */
export async function runWorkingSnapshot(opts: {
  note?: string;
  sendEmail?: boolean;
  includeExcelBuffer?: boolean;
}): Promise<DbBackupResult> {
  const reportDate = romeDateString();
  const note =
    opts.note?.trim() ||
    `Versione funzionante salvata il ${formatRomeDateTime(new Date())}`;

  const [excel, json] = await Promise.all([
    buildFullDbExcelBuffer(),
    buildFullDbJsonDump(note),
  ]);

  const { count: newContractsToday } = await countNewContractsToday(reportDate);
  const wantEmail = opts.sendEmail !== false;
  let emailed = false;
  let mailError: string | undefined;
  const jsonInEmail = json.buffer.length <= MAX_JSON_EMAIL_BYTES;

  if (wantEmail) {
    const to = backupRecipient();
    const lines = [
      `VERSIONE FUNZIONANTE CRM – punto di ripristino`,
      `Generato: ${formatRomeDateTime(new Date())}`,
      `Nota: ${note}`,
      `Commit codice (git): ${json.gitHash}`,
      "",
      `Clienti: ${excel.counts.clients}`,
      `Contratti: ${excel.counts.contracts}`,
      `Provvigioni: ${excel.counts.commissions}`,
      "",
      "Allegati:",
      `1) Excel (${excel.filename}) — tutti i contratti pagati/da pagare, clienti, ecc.`,
      jsonInEmail
        ? `2) JSON (${json.filename}) — dump completo DB (senza foto/PDF binari).`
        : `2) JSON troppo grande per email (${(json.buffer.length / 1024 / 1024).toFixed(1)} MB). Usa sul PC: npm run snapshot`,
      "",
      "COME TORNARE INDIETRO:",
      "• DATI: tieni questo Excel/JSON. Puoi reimportare da Archivio o chiedere ripristino.",
      "• CODICE (sito): su GitHub fai checkout del commit indicato sopra.",
      "• Ogni sera ricevi già il backup Excel giornaliero automatico.",
    ];
    const body = lines.join("\n");
    const attachments: {
      filename: string;
      content: Buffer;
      contentType?: string;
    }[] = [
      {
        filename: excel.filename,
        content: excel.buffer,
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ];
    if (jsonInEmail) {
      attachments.push({
        filename: json.filename,
        content: json.buffer,
        contentType: "application/json",
      });
    }

    const mail = await sendMail({
      to,
      subject: `CRM · Versione funzionante ${reportDate} (${excel.counts.contracts} contratti)`,
      text: body,
      html: textToHtmlParagraphs(body),
      attachments,
    });

    if (mail.ok) {
      emailed = true;
      await prisma.backupLog.create({
        data: {
          filename: `WORKING|${excel.filename}|${json.filename}|${json.gitHash}|${note.slice(0, 120)}`,
          size: excel.buffer.length + (jsonInEmail ? json.buffer.length : 0),
          status: "WORKING",
        },
      });
    } else {
      mailError = mail.error ?? "Invio email fallito";
      await prisma.backupLog.create({
        data: {
          filename: `WORKING|${excel.filename}|${json.filename}`,
          size: excel.buffer.length,
          status: mail.skipped ? "SKIPPED_NO_SMTP" : "ERROR",
        },
      });
    }
  } else {
    await prisma.backupLog.create({
      data: {
        filename: `WORKING|${excel.filename}|${json.filename}|${json.gitHash}`,
        size: excel.buffer.length,
        status: "WORKING_LOCAL",
      },
    });
  }

  return {
    ok: wantEmail ? emailed : true,
    filename: excel.filename,
    jsonFilename: json.filename,
    jsonIncludedInEmail: jsonInEmail,
    gitHash: json.gitHash,
    size: excel.buffer.length,
    newContractsToday,
    reportDate,
    counts: excel.counts,
    emailed,
    error: mailError,
    buffer: opts.includeExcelBuffer ? excel.buffer : undefined,
  };
}
