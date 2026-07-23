-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "addressesMatch" BOOLEAN,
ADD COLUMN     "classification" TEXT,
ADD COLUMN     "iban" TEXT,
ADD COLUMN     "pec" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "supplyAddress" TEXT,
ADD COLUMN     "supplyCity" TEXT,
ADD COLUMN     "supplyProvince" TEXT,
ADD COLUMN     "supplyRegion" TEXT,
ADD COLUMN     "supplyZipCode" TEXT;

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "agency" TEXT,
ADD COLUMN     "attachmentsJson" TEXT,
ADD COLUMN     "bandCount" INTEGER,
ADD COLUMN     "bandsJson" TEXT,
ADD COLUMN     "collectionDate" TIMESTAMP(3),
ADD COLUMN     "commissionConfirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "commissionConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "manuallyVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "monthlyPeriod" TEXT,
ADD COLUMN     "operationType" TEXT,
ADD COLUMN     "parentExternalId" TEXT,
ADD COLUMN     "paymentMethod" TEXT,
ADD COLUMN     "paymentStatus" TEXT,
ADD COLUMN     "pcv" DECIMAL(10,4),
ADD COLUMN     "podPdr" TEXT,
ADD COLUMN     "pricePerKwh" DECIMAL(10,6),
ADD COLUMN     "priceType" TEXT,
ADD COLUMN     "productName" TEXT,
ADD COLUMN     "receivedDate" TIMESTAMP(3),
ADD COLUMN     "recurrence" TEXT,
ADD COLUMN     "rowType" TEXT,
ADD COLUMN     "stornoEndDate" TIMESTAMP(3),
ADD COLUMN     "toWork" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "utilityType" TEXT,
ADD COLUMN     "workEmailDate" TIMESTAMP(3),
ADD COLUMN     "workStatus" TEXT;

-- CreateIndex
CREATE INDEX "Client_email_idx" ON "Client"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_externalId_key" ON "Contract"("externalId");

-- CreateIndex
CREATE INDEX "Contract_podPdr_idx" ON "Contract"("podPdr");

-- CreateIndex
CREATE INDEX "Contract_insertionDate_idx" ON "Contract"("insertionDate");

-- CreateIndex
CREATE INDEX "Contract_expiryDate_idx" ON "Contract"("expiryDate");

-- CreateIndex
CREATE INDEX "Contract_commissionConfirmed_idx" ON "Contract"("commissionConfirmed");
