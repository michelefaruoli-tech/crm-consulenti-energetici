import "server-only";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { MASTER_EMAIL } from "@/lib/constants";

export type MailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

export type SendMailResult = {
  ok: boolean;
  skipped?: boolean;
  messageId?: string;
  error?: string;
};

export function getMasterEmail(): string {
  return process.env.MASTER_EMAIL?.trim() || MASTER_EMAIL;
}

export function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim());
}

function smtpOptions(): SMTPTransport.Options {
  const port = Number(process.env.SMTP_PORT ?? 587);
  const secureEnv = process.env.SMTP_SECURE?.toLowerCase();
  const secure =
    secureEnv === "true" || secureEnv === "1" || port === 465;

  return {
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS ?? process.env.SMTP_PASSWORD,
    },
  };
}

function fromAddress(): string {
  const email =
    process.env.SMTP_FROM_EMAIL?.trim() ||
    process.env.SMTP_FROM?.trim() ||
    process.env.SMTP_USER ||
    "noreply@fmconsulenza.it";
  const name = process.env.SMTP_FROM_NAME?.trim() || "CRM FM Consulenza";
  return `"${name}" <${email}>`;
}

/** Invio email lato server. Mai chiamare dal client. */
export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
}): Promise<SendMailResult> {
  if (!isSmtpConfigured()) {
    return {
      ok: false,
      skipped: true,
      error:
        "SMTP non configurato. Imposta SMTP_HOST, SMTP_USER, SMTP_PASS (o SMTP_PASSWORD) su Vercel.",
    };
  }

  try {
    const transporter = nodemailer.createTransport(smtpOptions());
    const info = await transporter.sendMail({
      from: fromAddress(),
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      attachments: opts.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
    return { ok: true, messageId: String(info.messageId ?? "") };
  } catch (e) {
    const raw = e instanceof Error ? e.message : "Errore SMTP";
    // Non esporre dettagli sensibili (auth user/host completi) all'utente finale
    const safe = raw
      .replace(/pass(word)?[=:].*/gi, "[redacted]")
      .slice(0, 280);
    console.error("[smtp] send failed", safe);
    return { ok: false, error: safe };
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function textToHtmlParagraphs(text: string): string {
  return text
    .split("\n")
    .map((line) => `<p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:14px;color:#1e293b">${escapeHtml(line) || "&nbsp;"}</p>`)
    .join("");
}
