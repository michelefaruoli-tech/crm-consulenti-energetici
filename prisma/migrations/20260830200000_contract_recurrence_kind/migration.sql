-- Ricorrenza canonica indicizzabile.
-- Il campo testuale `recurrence` restava filtrato con ILIKE '%ricor%' / '%mensil%' / '%annu%',
-- predicati che Postgres non puo' risolvere via indice (scansione completa a ogni query).

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContractRecurrenceKind') THEN
    CREATE TYPE "ContractRecurrenceKind" AS ENUM ('UT', 'M', 'R');
  END IF;
END
$$;

-- AlterTable
ALTER TABLE "Contract"
  ADD COLUMN IF NOT EXISTS "recurrenceKind" "ContractRecurrenceKind" NOT NULL DEFAULT 'UT';

-- Backfill: stessa semantica di normalizeRecurrence() in src/lib/recurring.ts.
-- L'ordine conta: annuale va valutato PRIMA di mensile ('ricorrente annuale' e' R, non M).
UPDATE "Contract"
SET "recurrenceKind" = 'R'
WHERE "recurrence" IS NOT NULL
  AND (
    "recurrence" ~* '^\s*r\s*$'
    OR "recurrence" ~* 'annu'
    OR "recurrence" ~* '12\s*mes'
    OR "recurrence" ~* 'dopo\s*12'
  );

UPDATE "Contract"
SET "recurrenceKind" = 'M'
WHERE "recurrenceKind" <> 'R'
  AND "recurrence" IS NOT NULL
  AND (
    "recurrence" ~* '^\s*m\s*$'
    OR "recurrence" ~* 'mensil'
    OR "recurrence" ~* 'ricor'
  );

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Contract_recurrenceKind_idx" ON "Contract"("recurrenceKind");
CREATE INDEX IF NOT EXISTS "Contract_deletedAt_isHistorical_recurrenceKind_idx" ON "Contract"("deletedAt", "isHistorical", "recurrenceKind");
CREATE INDEX IF NOT EXISTS "Contract_collaboratorId_deletedAt_isHistorical_idx" ON "Contract"("collaboratorId", "deletedAt", "isHistorical");
CREATE INDEX IF NOT EXISTS "RecurringMonth_status_period_idx" ON "RecurringMonth"("status", "period");
CREATE INDEX IF NOT EXISTS "RecurringMonth_contractId_status_idx" ON "RecurringMonth"("contractId", "status");
