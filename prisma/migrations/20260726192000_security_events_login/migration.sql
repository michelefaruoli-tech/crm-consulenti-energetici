-- UserSecurityEvent: login falliti senza userId + email/details
ALTER TABLE "UserSecurityEvent" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "UserSecurityEvent" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "UserSecurityEvent" ADD COLUMN IF NOT EXISTS "details" TEXT;
CREATE INDEX IF NOT EXISTS "UserSecurityEvent_ipAddress_createdAt_idx" ON "UserSecurityEvent"("ipAddress", "createdAt");
CREATE INDEX IF NOT EXISTS "UserSecurityEvent_createdAt_idx" ON "UserSecurityEvent"("createdAt");
