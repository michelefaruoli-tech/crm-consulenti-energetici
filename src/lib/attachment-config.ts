/**
 * Limiti allegati e policy email/storage.
 * Storage attuale: PostgreSQL (campo Document.contentBase64), path logico `db://…`.
 * NON usare il filesystem della funzione Vercel come archivio permanente.
 */

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v == null || v === "") return fallback;
  return v === "1" || v === "true" || v === "yes";
}

export const attachmentConfig = {
  /** Max MB per singolo file (upload) */
  maxFileMb: envInt("MAX_ATTACHMENT_SIZE_MB", 15),
  /** Max MB totali per contratto */
  maxTotalMb: envInt("MAX_TOTAL_ATTACHMENTS_SIZE_MB", 25),
  /** Max numero allegati per contratto */
  maxCount: envInt("MAX_ATTACHMENTS_PER_CONTRACT", 10),
  /**
   * Max MB da allegare INLINE nell'email SMTP.
   * Oltre questa soglia: solo link autenticati nel corpo email.
   * (Limiti tipici SMTP/provider ~10–25MB; Vercel function body ~4.5MB in upload)
   */
  emailInlineMaxMb: envInt("EMAIL_INLINE_MAX_MB", 8),
  /** Elimina contentBase64 dopo email SENT (metadati restano). Default false. */
  deleteAfterEmail: envBool("DELETE_ATTACHMENTS_AFTER_EMAIL", false),
  /** Giorni di retention contenuto (cron). 0 = disabilitato. */
  retentionDays: envInt("ATTACHMENT_RETENTION_DAYS", 30),
};

export function maxFileBytes(): number {
  return attachmentConfig.maxFileMb * 1024 * 1024;
}

export function maxTotalBytes(): number {
  return attachmentConfig.maxTotalMb * 1024 * 1024;
}

export function emailInlineMaxBytes(): number {
  return attachmentConfig.emailInlineMaxMb * 1024 * 1024;
}

export const ALLOWED_ATTACHMENT_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/jpg",
] as const;

export function isAllowedAttachment(filename: string, mime: string): boolean {
  if ((ALLOWED_ATTACHMENT_MIME as readonly string[]).includes(mime)) return true;
  return /\.(pdf|jpe?g|png)$/i.test(filename);
}

/** Provider storage effettivo del progetto. */
export const STORAGE_PROVIDER = "postgres_base64" as const;
export const STORAGE_DESCRIPTION =
  "Allegati salvati in PostgreSQL (Neon) come Base64 nel campo Document.contentBase64. path = db://…. Accesso solo via /api/documents/[id] autenticato.";
