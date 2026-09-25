-- AlterTable
ALTER TABLE "WarehouseDischarge" ADD COLUMN     "activity" TEXT,
ADD COLUMN     "ccaNo" TEXT,
ADD COLUMN     "ccakValidated" TEXT,
ADD COLUMN     "damagedBagsOffloaded" INTEGER,
ADD COLUMN     "deliveryNoteNo" TEXT,
ADD COLUMN     "ficheDateRaw" TEXT,
ADD COLUMN     "goodBagsOffloaded" INTEGER,
ADD COLUMN     "lotDry" TEXT,
ADD COLUMN     "netWeightBookKg" DECIMAL(65,30),
ADD COLUMN     "newBagsUsedRecondition" INTEGER,
ADD COLUMN     "q1Fot" DECIMAL(65,30),
ADD COLUMN     "q1GoodKernelG" DECIMAL(65,30),
ADD COLUMN     "q1ImmatureG" DECIMAL(65,30),
ADD COLUMN     "q1Kor" DECIMAL(65,30),
ADD COLUMN     "q1MoisturePct" DECIMAL(65,30),
ADD COLUMN     "q1Murli" DECIMAL(65,30),
ADD COLUMN     "q1NutCount" DECIMAL(65,30),
ADD COLUMN     "q1OilG" DECIMAL(65,30),
ADD COLUMN     "q1RejectionG" DECIMAL(65,30),
ADD COLUMN     "q1ShellG" DECIMAL(65,30),
ADD COLUMN     "q1Shot" DECIMAL(65,30),
ADD COLUMN     "q1SpottedG" DECIMAL(65,30),
ADD COLUMN     "q1TotalDefectG" DECIMAL(65,30),
ADD COLUMN     "q1TotalKernelsG" DECIMAL(65,30),
ADD COLUMN     "q1TotalYieldPct" DECIMAL(65,30),
ADD COLUMN     "q1UsefulKernelYieldPct" DECIMAL(65,30),
ADD COLUMN     "q1VoidG" DECIMAL(65,30),
ADD COLUMN     "q2AfterDryKor" DECIMAL(65,30),
ADD COLUMN     "q2Fot" DECIMAL(65,30),
ADD COLUMN     "q2GoodKernelG" DECIMAL(65,30),
ADD COLUMN     "q2ImmatureG" DECIMAL(65,30),
ADD COLUMN     "q2Kor" DECIMAL(65,30),
ADD COLUMN     "q2MoisturePct" DECIMAL(65,30),
ADD COLUMN     "q2Murli" DECIMAL(65,30),
ADD COLUMN     "q2MurliTotalPct" DECIMAL(65,30),
ADD COLUMN     "q2NutCount" DECIMAL(65,30),
ADD COLUMN     "q2OilG" DECIMAL(65,30),
ADD COLUMN     "q2RejectionG" DECIMAL(65,30),
ADD COLUMN     "q2ShellG" DECIMAL(65,30),
ADD COLUMN     "q2Shot" DECIMAL(65,30),
ADD COLUMN     "q2SpottedG" DECIMAL(65,30),
ADD COLUMN     "q2TotalDefectG" DECIMAL(65,30),
ADD COLUMN     "q2TotalKernelsG" DECIMAL(65,30),
ADD COLUMN     "q2TotalYieldPct" DECIMAL(65,30),
ADD COLUMN     "q2UsefulKernelYieldPct" DECIMAL(65,30),
ADD COLUMN     "q2VoidG" DECIMAL(65,30),
ADD COLUMN     "reconditionBags" INTEGER,
ADD COLUMN     "reconditionFlag" INTEGER,
ADD COLUMN     "reconditionedBags" INTEGER,
ADD COLUMN     "storageArea" TEXT,
ADD COLUMN     "totalBagsDischarged" INTEGER,
ADD COLUMN     "totalBagsStock" INTEGER,
ADD COLUMN     "weightDifferenceKg" DECIMAL(65,30);

-- CreateTable
CREATE TABLE "WarehouseDispatchLine" (
    "id" TEXT NOT NULL,
    "sn" INTEGER,
    "chargeDate" TIMESTAMP(3),
    "chargeDateRaw" TEXT,
    "warehouseSite" TEXT,
    "vyogeNumber" TEXT,
    "remark" TEXT,
    "scaleLocation" TEXT,
    "warehouse" TEXT,
    "whOrDirect" TEXT,
    "bin" TEXT,
    "origin" TEXT,
    "truckNo" TEXT,
    "transporter" TEXT,
    "driver" TEXT,
    "phone" TEXT,
    "whReceiptNo" TEXT,
    "ficheCca" TEXT,
    "binwiseLoadedBags" INTEGER,
    "totalBags" INTEGER,
    "grossWt" DECIMAL(65,30),
    "netWeight" DECIMAL(65,30),
    "status" TEXT,
    "unloadingStatus" TEXT,
    "browns" DECIMAL(65,30),
    "voids" DECIMAL(65,30),
    "oil" DECIMAL(65,30),
    "totDefect" DECIMAL(65,30),
    "goodKernel" DECIMAL(65,30),
    "immature" DECIMAL(65,30),
    "spotted" DECIMAL(65,30),
    "totKernels" DECIMAL(65,30),
    "kor" DECIMAL(65,30),
    "shot" DECIMAL(65,30),
    "fot" DECIMAL(65,30),
    "usefulKernelsYield" DECIMAL(65,30),
    "totalYield" DECIMAL(65,30),
    "moisture" DECIMAL(65,30),
    "nc" DECIMAL(65,30),
    "shell" DECIMAL(65,30),
    "bagsYakro" INTEGER,
    "grossYakro" DECIMAL(65,30),
    "differenceWeight" DECIMAL(65,30),
    "sheetRow" INTEGER,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseDispatchLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DryingBatch" (
    "id" TEXT NOT NULL,
    "sn" INTEGER NOT NULL,
    "dryingDate" TIMESTAMP(3),
    "dryingDateRaw" TEXT,
    "warehouseSite" TEXT,
    "warehouse" TEXT,
    "sourceBinNo" TEXT,
    "destinationBinNo" TEXT,
    "lotNoRaw" TEXT,
    "lotNo" TEXT,
    "whReceiptNoRaw" TEXT,
    "ficheNoRaw" TEXT,
    "originRaw" TEXT,
    "supplierNameRaw" TEXT,
    "supplierCodeRaw" TEXT,
    "ccakSupplierCodeRaw" TEXT,
    "status" TEXT,
    "dryType" TEXT,
    "destinationRaw" TEXT,
    "issuedGrossWithBagsPalletsKg" DECIMAL(65,30),
    "issuedPalletWeightKg" DECIMAL(65,30),
    "issuedGrossWithBagsKg" DECIMAL(65,30),
    "issuedBags" INTEGER,
    "issuedNetWeightKg" DECIMAL(65,30),
    "receivedGrossWithBagsPalletsKg" DECIMAL(65,30),
    "receivedPalletWeightKg" DECIMAL(65,30),
    "receivedGrossWithBagsKg" DECIMAL(65,30),
    "receivedBags" INTEGER,
    "receivedNetWeightKg" DECIMAL(65,30),
    "inputMoisturePct" DECIMAL(65,30),
    "inputNutCount" DECIMAL(65,30),
    "inputKor" DECIMAL(65,30),
    "outputMoisturePct" DECIMAL(65,30),
    "outputNutCount" DECIMAL(65,30),
    "outputKor" DECIMAL(65,30),
    "oil" DECIMAL(65,30),
    "rejection" DECIMAL(65,30),
    "goodKernel" DECIMAL(65,30),
    "immature" DECIMAL(65,30),
    "spotted" DECIMAL(65,30),
    "shell" DECIMAL(65,30),
    "void" DECIMAL(65,30),
    "moistureLossPct" DECIMAL(65,30),
    "dryingLossKg" DECIMAL(65,30),
    "dryingLossPct" DECIMAL(65,30),
    "triageLossKg" DECIMAL(65,30),
    "triageLossPct" DECIMAL(65,30),
    "damagedNutsKg" DECIMAL(65,30),
    "inputBagsForDrying" INTEGER,
    "outputBagsAfterDrying" INTEGER,
    "dryingOrPicking" TEXT,
    "remarks" TEXT,
    "issuedToProduction" TEXT,
    "reDryingDate" TIMESTAMP(3),
    "reDryingDateRaw" TEXT,
    "moistureFirstRedryPct" DECIMAL(65,30),
    "moistureSecondDryPct" DECIMAL(65,30),
    "issuedToProduction3" TEXT,
    "remarks4" TEXT,
    "needsLotAllocationClarificationRaw" TEXT,
    "sheetRow" INTEGER,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DryingBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseActivityLedgerEntry" (
    "id" TEXT NOT NULL,
    "activityDate" TIMESTAMP(3),
    "activityDateRaw" TEXT,
    "activityType" TEXT,
    "particulars" TEXT,
    "offloaded" TEXT,
    "bags" TEXT,
    "quantityMt" TEXT,
    "ficheNo" TEXT,
    "lotNo" TEXT,
    "vendor" TEXT,
    "rate" TEXT,
    "total" TEXT,
    "referenceNo" TEXT,
    "remarks" TEXT,
    "grossWeightWithPalletKg" TEXT,
    "palletCount" TEXT,
    "grossWeightKg" TEXT,
    "grossWeightWithoutPalletKg" TEXT,
    "netWeightKg" TEXT,
    "sheetRow" INTEGER,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseActivityLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuedToProduction" (
    "id" TEXT NOT NULL,
    "btmNo" TEXT,
    "sNo" TEXT,
    "date" TEXT,
    "rcn" TEXT,
    "sourceBin" TEXT,
    "dryBin" TEXT,
    "binStatus" TEXT,
    "korIssued" TEXT,
    "nutCount" TEXT,
    "gk" TEXT,
    "moisture" TEXT,
    "immature" TEXT,
    "spotted" TEXT,
    "rejection" TEXT,
    "oilGram" TEXT,
    "voidGram" TEXT,
    "shellGram" TEXT,
    "ficheNo" TEXT,
    "bagInStockAfterDry" TEXT,
    "noOfBagIssuedToProduction" TEXT,
    "avgBagWtEmptyBag" TEXT,
    "bagWtEmptyBag" TEXT,
    "noOfPallet" TEXT,
    "avgPalletWt" TEXT,
    "palletWeightKg" TEXT,
    "grossWtBeforeDry" TEXT,
    "grossWtAfterDryingWithJuteBag" TEXT,
    "netWtWithoutJuteBag" TEXT,
    "dateOfIssueToCalibration" TEXT,
    "receivedByProductionNetWt" TEXT,
    "issuedFrom" TEXT,
    "diffInIssue" TEXT,
    "remarks" TEXT,
    "checkValue" TEXT,
    "sheetRow" INTEGER,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssuedToProduction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WarehouseDispatchLine_vyogeNumber_idx" ON "WarehouseDispatchLine"("vyogeNumber");

-- CreateIndex
CREATE INDEX "WarehouseDispatchLine_ficheCca_idx" ON "WarehouseDispatchLine"("ficheCca");

-- CreateIndex
CREATE INDEX "WarehouseDispatchLine_warehouseSite_idx" ON "WarehouseDispatchLine"("warehouseSite");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseDispatchLine_source_sheetRow_key" ON "WarehouseDispatchLine"("source", "sheetRow");

-- CreateIndex
CREATE INDEX "DryingBatch_lotNo_idx" ON "DryingBatch"("lotNo");

-- CreateIndex
CREATE INDEX "DryingBatch_ficheNoRaw_idx" ON "DryingBatch"("ficheNoRaw");

-- CreateIndex
CREATE INDEX "DryingBatch_warehouseSite_idx" ON "DryingBatch"("warehouseSite");

-- CreateIndex
CREATE UNIQUE INDEX "DryingBatch_warehouse_sn_key" ON "DryingBatch"("warehouse", "sn");

-- CreateIndex
CREATE INDEX "WarehouseActivityLedgerEntry_ficheNo_idx" ON "WarehouseActivityLedgerEntry"("ficheNo");

-- CreateIndex
CREATE INDEX "WarehouseActivityLedgerEntry_lotNo_idx" ON "WarehouseActivityLedgerEntry"("lotNo");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseActivityLedgerEntry_source_sheetRow_key" ON "WarehouseActivityLedgerEntry"("source", "sheetRow");

-- CreateIndex
CREATE INDEX "IssuedToProduction_btmNo_idx" ON "IssuedToProduction"("btmNo");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedToProduction_source_sheetRow_key" ON "IssuedToProduction"("source", "sheetRow");
