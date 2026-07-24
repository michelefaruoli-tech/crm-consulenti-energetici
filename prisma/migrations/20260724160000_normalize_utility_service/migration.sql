-- Migrazione sicura: normalizza utilityType legacy / tecnici → LUCE | GAS | ALTRO
-- Non cancella POD/PDR: restano nei campi tecnici.

-- Valori che erano usati come "servizio" ma sono codici tecnici → inferisci da pod/pdr
UPDATE "Contract"
SET "utilityType" = 'LUCE'
WHERE UPPER(COALESCE("utilityType", '')) IN ('POD', 'POD/PDR', 'POD_PDR', 'ENERGIA', 'EE', 'POWER')
  AND (
    COALESCE("pod", '') <> ''
    OR UPPER(COALESCE("podPdr", '')) LIKE 'IT%'
  );

UPDATE "Contract"
SET "utilityType" = 'GAS'
WHERE UPPER(COALESCE("utilityType", '')) IN ('PDR', 'POD/PDR', 'POD_PDR')
  AND "utilityType" IS DISTINCT FROM 'LUCE'
  AND (
    COALESCE("pdr", '') <> ''
    OR (COALESCE("podPdr", '') ~ '^[0-9]{14}$')
  );

-- Dual / telefonia / POS / FV → Altro (conserva etichetta in serviceOther se vuoto)
UPDATE "Contract"
SET
  "serviceOther" = COALESCE(
    NULLIF(TRIM("serviceOther"), ''),
    CASE UPPER(COALESCE("utilityType", ''))
      WHEN 'DUAL' THEN 'Dual Luce e Gas'
      WHEN 'TELEFONIA' THEN 'Telefonia'
      WHEN 'POS' THEN 'POS'
      WHEN 'FOTOVOLTAICO' THEN 'Fotovoltaico'
      ELSE "utilityType"
    END
  ),
  "utilityType" = 'ALTRO'
WHERE UPPER(COALESCE("utilityType", '')) IN (
  'DUAL',
  'DUAL_LUCE_GAS',
  'TELEFONIA',
  'TEL',
  'POS',
  'FOTOVOLTAICO',
  'FV',
  'SOLARE',
  'OTHER'
);

-- Residui tecnici senza match → ALTRO
UPDATE "Contract"
SET
  "serviceOther" = COALESCE(NULLIF(TRIM("serviceOther"), ''), "utilityType"),
  "utilityType" = 'ALTRO'
WHERE UPPER(COALESCE("utilityType", '')) IN ('POD', 'PDR', 'POD/PDR', 'POD_PDR', 'ENERGIA');
