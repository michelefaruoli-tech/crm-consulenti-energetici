-- CreateEnum
CREATE TYPE "PayoutSourceKind" AS ENUM ('SUPPLIER_STATEMENT', 'MASTER_STATEMENT', 'MARKETPLACE', 'OTHER');

-- CreateEnum
CREATE TYPE "PayoutFileKind" AS ENUM ('XLSX', 'CSV');

-- CreateEnum
CREATE TYPE "PayoutRunStatus" AS ENUM ('DRAFT', 'APPLIED', 'REVERTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PayoutBatchStatus" AS ENUM ('PARSED', 'APPLIED', 'PARTIALLY_APPLIED', 'REVERTED', 'FAILED');

-- CreateEnum
CREATE TYPE "PayoutRowMatch" AS ENUM ('MATCHED', 'AMBIGUOUS', 'UNMATCHED', 'IGNORED', 'APPLIED', 'ERROR');

-- CreateEnum
CREATE TYPE "PayoutMarkMode" AS ENUM ('INCASSATO', 'LIQUIDATO');

-- CreateEnum
CREATE TYPE "PayoutAdjustmentKind" AS ENUM ('EXTRA', 'STORNO', 'ACCONTO', 'RETTIFICA');

-- CreateEnum
CREATE TYPE "PayoutReportStatus" AS ENUM ('PENDING', 'GENERATING', 'READY', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "PayoutReportDelivery" AS ENUM ('PENDING', 'SENDING', 'SENT', 'ERROR', 'SKIPPED');

-- CreateTable
CREATE TABLE "PayoutSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PayoutSourceKind" NOT NULL DEFAULT 'SUPPLIER_STATEMENT',
    "supplierId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportTemplate" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileKind" "PayoutFileKind" NOT NULL DEFAULT 'XLSX',
    "builtinKey" TEXT,
    "sheetMatchJson" TEXT,
    "headerRow" INTEGER NOT NULL DEFAULT 1,
    "columnMapJson" TEXT NOT NULL,
    "numberFormatJson" TEXT,
    "dateFormat" TEXT,
    "skipRowRulesJson" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutRun" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "PayoutRunStatus" NOT NULL DEFAULT 'DRAFT',
    "markMode" "PayoutMarkMode" NOT NULL DEFAULT 'INCASSATO',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "appliedById" TEXT,
    "appliedAt" TIMESTAMP(3),
    "liquidatedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutBatch" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "templateId" TEXT,
    "filename" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "status" "PayoutBatchStatus" NOT NULL DEFAULT 'PARSED',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "matchedRows" INTEGER NOT NULL DEFAULT 0,
    "ambiguousRows" INTEGER NOT NULL DEFAULT 0,
    "unmatchedRows" INTEGER NOT NULL DEFAULT 0,
    "appliedRows" INTEGER NOT NULL DEFAULT 0,
    "computedTotal" DECIMAL(12,2),
    "declaredTotal" DECIMAL(12,2),
    "error" TEXT,
    "uploadedById" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL DEFAULT '',
    "rowIndex" INTEGER NOT NULL,
    "rawJson" TEXT NOT NULL,
    "podRaw" TEXT,
    "podKey" TEXT,
    "clientNameRaw" TEXT,
    "fiscalCodeRaw" TEXT,
    "supplierHint" TEXT,
    "collaboratorHint" TEXT,
    "amount" DECIMAL(12,2),
    "period" TEXT,
    "matchStatus" "PayoutRowMatch" NOT NULL DEFAULT 'UNMATCHED',
    "matchScore" INTEGER,
    "matchReason" TEXT,
    "contractId" TEXT,
    "collaboratorId" TEXT,
    "recurringMonthId" TEXT,
    "previousStateJson" TEXT,
    "candidateIdsJson" TEXT,
    "appliedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutAdjustment" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "collaboratorId" TEXT NOT NULL,
    "kind" "PayoutAdjustmentKind" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT NOT NULL,
    "contractId" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutReportRun" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "PayoutReportStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutReportItem" (
    "id" TEXT NOT NULL,
    "reportRunId" TEXT NOT NULL,
    "collaboratorId" TEXT NOT NULL,
    "importedTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "adjustmentsTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "snapshotJson" TEXT NOT NULL,
    "delivery" "PayoutReportDelivery" NOT NULL DEFAULT 'PENDING',
    "toEmail" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutReportItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayoutSource_active_idx" ON "PayoutSource"("active");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutSource_name_key" ON "PayoutSource"("name");

-- CreateIndex
CREATE INDEX "ImportTemplate_sourceId_active_idx" ON "ImportTemplate"("sourceId", "active");

-- CreateIndex
CREATE INDEX "PayoutRun_status_idx" ON "PayoutRun"("status");

-- CreateIndex
CREATE INDEX "PayoutRun_period_idx" ON "PayoutRun"("period");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutRun_period_label_key" ON "PayoutRun"("period", "label");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutBatch_sha256_key" ON "PayoutBatch"("sha256");

-- CreateIndex
CREATE INDEX "PayoutBatch_runId_idx" ON "PayoutBatch"("runId");

-- CreateIndex
CREATE INDEX "PayoutBatch_status_idx" ON "PayoutBatch"("status");

-- CreateIndex
CREATE INDEX "PayoutRow_batchId_matchStatus_idx" ON "PayoutRow"("batchId", "matchStatus");

-- CreateIndex
CREATE INDEX "PayoutRow_podKey_idx" ON "PayoutRow"("podKey");

-- CreateIndex
CREATE INDEX "PayoutRow_collaboratorId_idx" ON "PayoutRow"("collaboratorId");

-- CreateIndex
CREATE INDEX "PayoutRow_contractId_idx" ON "PayoutRow"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutRow_batchId_sheetName_rowIndex_key" ON "PayoutRow"("batchId", "sheetName", "rowIndex");

-- CreateIndex
CREATE INDEX "PayoutAdjustment_runId_collaboratorId_idx" ON "PayoutAdjustment"("runId", "collaboratorId");

-- CreateIndex
CREATE INDEX "PayoutAdjustment_runId_voidedAt_idx" ON "PayoutAdjustment"("runId", "voidedAt");

-- CreateIndex
CREATE INDEX "PayoutReportRun_status_idx" ON "PayoutReportRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutReportRun_runId_version_key" ON "PayoutReportRun"("runId", "version");

-- CreateIndex
CREATE INDEX "PayoutReportItem_delivery_idx" ON "PayoutReportItem"("delivery");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutReportItem_reportRunId_collaboratorId_key" ON "PayoutReportItem"("reportRunId", "collaboratorId");

-- AddForeignKey
ALTER TABLE "PayoutSource" ADD CONSTRAINT "PayoutSource_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportTemplate" ADD CONSTRAINT "ImportTemplate_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "PayoutSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportTemplate" ADD CONSTRAINT "ImportTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRun" ADD CONSTRAINT "PayoutRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutBatch" ADD CONSTRAINT "PayoutBatch_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayoutRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutBatch" ADD CONSTRAINT "PayoutBatch_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "PayoutSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutBatch" ADD CONSTRAINT "PayoutBatch_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ImportTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutBatch" ADD CONSTRAINT "PayoutBatch_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRow" ADD CONSTRAINT "PayoutRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PayoutBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRow" ADD CONSTRAINT "PayoutRow_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRow" ADD CONSTRAINT "PayoutRow_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutAdjustment" ADD CONSTRAINT "PayoutAdjustment_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayoutRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutAdjustment" ADD CONSTRAINT "PayoutAdjustment_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutAdjustment" ADD CONSTRAINT "PayoutAdjustment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutAdjustment" ADD CONSTRAINT "PayoutAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutReportRun" ADD CONSTRAINT "PayoutReportRun_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayoutRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutReportRun" ADD CONSTRAINT "PayoutReportRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutReportItem" ADD CONSTRAINT "PayoutReportItem_reportRunId_fkey" FOREIGN KEY ("reportRunId") REFERENCES "PayoutReportRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutReportItem" ADD CONSTRAINT "PayoutReportItem_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

