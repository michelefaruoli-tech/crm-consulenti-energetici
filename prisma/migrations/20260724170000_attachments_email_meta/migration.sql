-- Metadati allegati + ultimo tentativo email
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "storageProvider" TEXT DEFAULT 'postgres_base64';
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "uploadedById" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "contentClearedAt" TIMESTAMP(3);
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "contentClearedReason" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "emailLastAttemptAt" TIMESTAMP(3);

-- Normalizza emailStatus legacy ERROR → FAILED (solo etichetta)
UPDATE "Contract"
SET "emailStatus" = 'FAILED'
WHERE "emailStatus" IN ('ERROR', 'SKIPPED_NO_SMTP');
