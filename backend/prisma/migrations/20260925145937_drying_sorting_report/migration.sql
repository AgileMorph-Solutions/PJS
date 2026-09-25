-- CreateTable
CREATE TABLE "DryingSortingReport" (
    "id" TEXT NOT NULL,
    "sn" INTEGER,
    "dryingDate" TIMESTAMP(3),
    "dryingDateRaw" TEXT,
    "warehouseSite" TEXT,
    "warehouse" TEXT,
    "unloadingBin" TEXT,
    "afterDryingBin" TEXT,
    "lotNo" TEXT,
    "lotNoRaw" TEXT,
    "whReceiptNoRaw" TEXT,
    "origin" TEXT,
    "supplierName" TEXT,
    "supplierCodeAnagroci" TEXT,
    "supplierCodeCcak" TEXT,
    "issuedNetWeightGrn" DECIMAL(65,30),
    "receivedNetWeightAfterDrying" DECIMAL(65,30),
    "inputMoisture" DECIMAL(65,30),
    "inputNutCount" DECIMAL(65,30),
    "inputKor" DECIMAL(65,30),
    "outputMoisture" DECIMAL(65,30),
    "outputNutCount" DECIMAL(65,30),
    "outputKor" DECIMAL(65,30),
    "drainageLossKg" DECIMAL(65,30),
    "lossPct" DECIMAL(65,30),
    "drainageLossKg2" DECIMAL(65,30),
    "drainageLossPct" DECIMAL(65,30),
    "goodOrDriedSacs" TEXT,
    "damagedNutsKgTriage" DECIMAL(65,30),
    "totalSacReceived" TEXT,
    "inputBagsForDrying" INTEGER,
    "outputBagsAfterDrying" INTEGER,
    "dryingPicking" TEXT,
    "remarks" TEXT,
    "sheetRow" INTEGER,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DryingSortingReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DryingSortingReport_lotNo_idx" ON "DryingSortingReport"("lotNo");

-- CreateIndex
CREATE INDEX "DryingSortingReport_warehouseSite_idx" ON "DryingSortingReport"("warehouseSite");

-- CreateIndex
CREATE UNIQUE INDEX "DryingSortingReport_source_sheetRow_key" ON "DryingSortingReport"("source", "sheetRow");
