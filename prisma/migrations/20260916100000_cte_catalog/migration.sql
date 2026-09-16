-- CreateEnum
CREATE TYPE "CteCategory" AS ENUM ('RESIDENZIALE', 'BUSINESS', 'CONDOMINI');

-- CreateEnum
CREATE TYPE "CtePriceKind" AS ENUM ('FISSO', 'VARIABILE');

-- CreateEnum
CREATE TYPE "CteUtility" AS ENUM ('LUCE', 'GAS');

-- CreateEnum
CREATE TYPE "CteNetworkLosses" AS ENUM ('INCLUDED', 'EXCLUDED', 'NOT_APPLICABLE');

-- CreateTable
CREATE TABLE "CteOffer" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "utility" "CteUtility" NOT NULL,
    "category" "CteCategory" NOT NULL,
    "commercialSegment" TEXT,
    "offerName" TEXT NOT NULL,
    "priceKind" "CtePriceKind" NOT NULL,
    "powerKwMin" DECIMAL(10,2),
    "powerKwMax" DECIMAL(10,2),
    "annualConsumptionMin" DECIMAL(14,2),
    "annualConsumptionMax" DECIMAL(14,2),
    "referenceConsumption" DECIMAL(12,2),
    "networkLosses" "CteNetworkLosses" NOT NULL,
    "ccvAnnual" DECIMAL(10,2),
    "ccvMonthly" DECIMAL(10,2),
    "spread" DECIMAL(10,6),
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "pdfStorageKey" TEXT,
    "pdfFilename" TEXT,
    "pdfMimeType" TEXT,
    "pdfContentBase64" TEXT,
    "pdfUploadedAt" TIMESTAMP(3),
    "extractionStatus" TEXT DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CteOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CtePriceBand" (
    "id" TEXT NOT NULL,
    "cteOfferId" TEXT NOT NULL,
    "timeBand" TEXT NOT NULL,
    "energyPrice" DECIMAL(10,6) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CtePriceBand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CteOffer_utility_category_priceKind_active_idx" ON "CteOffer"("utility", "category", "priceKind", "active");

-- CreateIndex
CREATE INDEX "CteOffer_supplierId_active_idx" ON "CteOffer"("supplierId", "active");

-- CreateIndex
CREATE INDEX "CteOffer_validTo_idx" ON "CteOffer"("validTo");

-- CreateIndex
CREATE INDEX "CteOffer_powerKwMin_powerKwMax_idx" ON "CteOffer"("powerKwMin", "powerKwMax");

-- CreateIndex
CREATE INDEX "CteOffer_annualConsumptionMin_annualConsumptionMax_idx" ON "CteOffer"("annualConsumptionMin", "annualConsumptionMax");

-- CreateIndex
CREATE INDEX "CtePriceBand_cteOfferId_idx" ON "CtePriceBand"("cteOfferId");

-- CreateIndex
CREATE UNIQUE INDEX "CtePriceBand_cteOfferId_timeBand_key" ON "CtePriceBand"("cteOfferId", "timeBand");

-- AddForeignKey
ALTER TABLE "CteOffer" ADD CONSTRAINT "CteOffer_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CtePriceBand" ADD CONSTRAINT "CtePriceBand_cteOfferId_fkey" FOREIGN KEY ("cteOfferId") REFERENCES "CteOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
