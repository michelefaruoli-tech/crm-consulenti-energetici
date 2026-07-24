-- AlterTable
ALTER TABLE "RecurringMonth" ADD COLUMN IF NOT EXISTS "settledPeriod" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RecurringMonth_settledPeriod_idx" ON "RecurringMonth"("settledPeriod");
