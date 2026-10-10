-- CreateEnum
CREATE TYPE "AgendaGenericNoteStatus" AS ENUM ('DA_CONTROLLARE', 'RISOLTA');

-- AlterTable: ogni riga esistente diventa una voce lista «da controllare»
ALTER TABLE "AgendaGenericNote" ADD COLUMN "status" "AgendaGenericNoteStatus" NOT NULL DEFAULT 'DA_CONTROLLARE';

-- DropIndex: non più una sola nota per utente
DROP INDEX "AgendaGenericNote_userId_key";

-- CreateIndex
CREATE INDEX "AgendaGenericNote_userId_status_idx" ON "AgendaGenericNote"("userId", "status");

-- CreateIndex
CREATE INDEX "AgendaGenericNote_userId_createdAt_idx" ON "AgendaGenericNote"("userId", "createdAt");

-- Pulizia: note vuote non hanno valore come voci lista
DELETE FROM "AgendaGenericNote" WHERE TRIM("text") = '';
