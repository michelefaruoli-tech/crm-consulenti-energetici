-- Indici per i filtri di colonna Provvigioni applicati sul database
-- (agenzia, tipo operazione, mese incasso, mese inizio fornitura, storno, gettone).
CREATE INDEX IF NOT EXISTS "Contract_deletedAt_isHistorical_agency_idx"
  ON "Contract" ("deletedAt", "isHistorical", "agency");

CREATE INDEX IF NOT EXISTS "Contract_deletedAt_isHistorical_operationType_idx"
  ON "Contract" ("deletedAt", "isHistorical", "operationType");

CREATE INDEX IF NOT EXISTS "Contract_deletedAt_isHistorical_collectionDate_idx"
  ON "Contract" ("deletedAt", "isHistorical", "collectionDate");

CREATE INDEX IF NOT EXISTS "Contract_deletedAt_isHistorical_supplyStartDate_idx"
  ON "Contract" ("deletedAt", "isHistorical", "supplyStartDate");

CREATE INDEX IF NOT EXISTS "Commission_stornoDate_idx"
  ON "Commission" ("stornoDate");

CREATE INDEX IF NOT EXISTS "Commission_expected_idx"
  ON "Commission" ("expected");
