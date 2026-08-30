-- CreateEnum
CREATE TYPE "AgendaItemType" AS ENUM ('APPOINTMENT', 'TASK');

-- CreateEnum
CREATE TYPE "AgendaPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "AgendaItem" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "type" "AgendaItemType" NOT NULL DEFAULT 'TASK',
    "priority" "AgendaPriority" NOT NULL DEFAULT 'MEDIUM',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "alertAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgendaItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgendaItem_userId_scheduledAt_idx" ON "AgendaItem"("userId", "scheduledAt");

-- CreateIndex
CREATE INDEX "AgendaItem_userId_completed_idx" ON "AgendaItem"("userId", "completed");

-- CreateIndex
CREATE INDEX "AgendaItem_alertAt_idx" ON "AgendaItem"("alertAt");

-- AddForeignKey
ALTER TABLE "AgendaItem" ADD CONSTRAINT "AgendaItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendaItem" ADD CONSTRAINT "AgendaItem_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
