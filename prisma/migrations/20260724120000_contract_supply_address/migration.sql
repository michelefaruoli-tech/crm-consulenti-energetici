-- Indirizzo fornitura e IBAN sul contratto (storico indipendente dall'anagrafica)
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "contractIban" TEXT;
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "sepaMandate" TEXT;
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "paymentNotes" TEXT;
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "supplyStreet" TEXT;
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "supplyStreetNumber" TEXT;
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "supplyCity" TEXT;
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "supplyProvince" TEXT;
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "supplyRegion" TEXT;
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "supplyZipCode" TEXT;
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "supplyCountry" TEXT DEFAULT 'Italia';
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "supplyAddress" TEXT;
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "addressesMatch" BOOLEAN;
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "voltageLevel" TEXT;

-- Backfill sicuro: copia indirizzo fornitura dal cliente ai contratti collegati
-- solo dove il contratto non ha ancora città/CAP/indirizzo
UPDATE "Contract" AS c
SET
  "supplyStreet" = COALESCE(c."supplyStreet", cl."supplyStreet", cl."street"),
  "supplyStreetNumber" = COALESCE(c."supplyStreetNumber", cl."supplyStreetNumber", cl."streetNumber"),
  "supplyCity" = COALESCE(c."supplyCity", cl."supplyCity"),
  "supplyProvince" = COALESCE(c."supplyProvince", cl."supplyProvince"),
  "supplyRegion" = COALESCE(c."supplyRegion", cl."supplyRegion"),
  "supplyZipCode" = COALESCE(c."supplyZipCode", cl."supplyZipCode"),
  "supplyAddress" = COALESCE(c."supplyAddress", cl."supplyAddress"),
  "addressesMatch" = COALESCE(c."addressesMatch", cl."addressesMatch"),
  "contractIban" = COALESCE(c."contractIban", cl."iban")
FROM "Client" AS cl
WHERE c."clientId" = cl.id
  AND (
    cl."supplyCity" IS NOT NULL
    OR cl."supplyZipCode" IS NOT NULL
    OR cl."supplyAddress" IS NOT NULL
    OR cl."supplyStreet" IS NOT NULL
    OR cl."iban" IS NOT NULL
  )
  AND c."supplyCity" IS NULL
  AND c."supplyZipCode" IS NULL
  AND c."supplyAddress" IS NULL
  AND c."supplyStreet" IS NULL;
