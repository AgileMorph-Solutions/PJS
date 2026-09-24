-- CreateTable
CREATE TABLE "ProductionBin" (
    "binNo" TEXT NOT NULL,
    "source" TEXT,

    CONSTRAINT "ProductionBin_pkey" PRIMARY KEY ("binNo")
);

-- CreateTable
CREATE TABLE "ProductionLot" (
    "lotNo" TEXT NOT NULL,
    "binNo" TEXT NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionLot_pkey" PRIMARY KEY ("lotNo")
);

-- CreateTable
CREATE TABLE "BtmIntake" (
    "btmNo" TEXT NOT NULL,
    "binNo" TEXT NOT NULL,
    "documentNo" TEXT,
    "fromLocation" TEXT,
    "toLocation" TEXT,
    "productionLine" TEXT,
    "issuePurpose" TEXT,
    "vehicleNo" TEXT,
    "timeOfDispatch" TEXT,
    "preparedByWarehouse" TEXT,
    "checkedByQa" TEXT,
    "receivedByProduction" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BtmIntake_pkey" PRIMARY KEY ("btmNo")
);

-- CreateTable
CREATE TABLE "BtmReceipt" (
    "id" TEXT NOT NULL,
    "btmNo" TEXT,
    "sNo" TEXT,
    "date" TEXT,
    "month" TEXT,
    "year" TEXT,
    "cropYear" TEXT,
    "sourceBinNo" TEXT,
    "binNo" TEXT,
    "receivedGrossQtyKgs" TEXT,
    "palletsBagsWtKgs" TEXT,
    "netWeightKgs" TEXT,

    CONSTRAINT "BtmReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BtmInputQuality" (
    "id" TEXT NOT NULL,
    "btmNo" TEXT,
    "sNo" TEXT,
    "date" TEXT,
    "month" TEXT,
    "year" TEXT,
    "cropYear" TEXT,
    "lotNo" TEXT,
    "binNo" TEXT,
    "nutCount" TEXT,
    "moisture" TEXT,
    "sampleWeightG" TEXT,
    "gkG" TEXT,
    "spotG" TEXT,
    "immatureG" TEXT,
    "oilG" TEXT,
    "rejectionG" TEXT,
    "voidsG" TEXT,
    "shellG" TEXT,
    "fruitWaste" TEXT,
    "korLbs" TEXT,
    "shotLbs" TEXT,
    "fotLbs" TEXT,
    "fruitWaste2" TEXT,
    "gkYield" TEXT,
    "totalYield" TEXT,

    CONSTRAINT "BtmInputQuality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BtmTallyRow" (
    "id" TEXT NOT NULL,
    "btmNo" TEXT,
    "slNo" TEXT,
    "date" TEXT,
    "week" TEXT,
    "month" TEXT,
    "sourceBin" TEXT,
    "binNo" TEXT,
    "palletNo" TEXT,
    "grossWeightKgs" TEXT,
    "noOfBags" TEXT,
    "bagsWeightKgs" TEXT,
    "palletWeightKgs" TEXT,
    "netWeightKgs" TEXT,
    "dust" TEXT,
    "voids" TEXT,

    CONSTRAINT "BtmTallyRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalibrationRun" (
    "id" TEXT NOT NULL,
    "btmNo" TEXT,
    "date" TEXT,
    "week" TEXT,
    "month" TEXT,
    "grossWeightKgs" TEXT,
    "bagsPalletKgs" TEXT,
    "netWeightRcnBagsKgs" TEXT,
    "binNo" TEXT,
    "dustKgs" TEXT,
    "voidsKgs" TEXT,
    "dust" TEXT,
    "voids" TEXT,
    "netWeightOfRcnIssuedToSilosKgs" TEXT,

    CONSTRAINT "CalibrationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SilosStockRow" (
    "id" TEXT NOT NULL,
    "binNo" TEXT,
    "date" TEXT,
    "openingStockKgs" TEXT,
    "sizedRcnKgs" TEXT,
    "cookedQtyKgs" TEXT,
    "sizeA25mm" TEXT,
    "sizeA25mm2" TEXT,
    "sizeA24mm" TEXT,
    "sizeAb23mm" TEXT,
    "sizeB22mm" TEXT,
    "sizeBc21mm" TEXT,
    "sizeC20mm" TEXT,
    "sizeD19mm" TEXT,
    "sizeE18mm" TEXT,
    "adjustedQty" TEXT,
    "batchNo" TEXT,
    "closingStockKgs" TEXT,

    CONSTRAINT "SilosStockRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WholesManualCalibration" (
    "id" TEXT NOT NULL,
    "binNo" TEXT,
    "date" TEXT,
    "samplingPoint" TEXT,
    "sizeMm" TEXT,
    "nutCountPerKg" TEXT,
    "sampleQtyGm" TEXT,
    "a" TEXT,
    "a2" TEXT,
    "a3" TEXT,
    "ab" TEXT,
    "b" TEXT,
    "bc" TEXT,
    "c" TEXT,
    "d" TEXT,
    "de" TEXT,
    "de2" TEXT,
    "errorCheck" TEXT,
    "a4" TEXT,
    "a5" TEXT,
    "a6" TEXT,
    "ab2" TEXT,
    "b2" TEXT,
    "bc2" TEXT,
    "c2" TEXT,
    "d2" TEXT,
    "de3" TEXT,
    "de4" TEXT,

    CONSTRAINT "WholesManualCalibration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CookingRun" (
    "id" TEXT NOT NULL,
    "lotNo" TEXT,
    "date" TEXT,
    "week" TEXT,
    "month" TEXT,
    "binNo" TEXT,
    "sizeA25mm" TEXT,
    "sizeA25mm2" TEXT,
    "sizeA24mm" TEXT,
    "sizeAb23mm" TEXT,
    "sizeB22mm" TEXT,
    "sizeBc21mm" TEXT,
    "sizeC20mm" TEXT,
    "sizeD19mm" TEXT,
    "sizeE18mm" TEXT,
    "adjustedQuantity" TEXT,
    "totalQty" TEXT,
    "noOfBags" TEXT,

    CONSTRAINT "CookingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShellingRun" (
    "id" TEXT NOT NULL,
    "lotNo" TEXT,
    "date" TEXT,
    "week" TEXT,
    "month" TEXT,
    "binNo" TEXT,
    "inputQuantityKgs" TEXT,
    "wholesKgs" TEXT,
    "piecesKgs" TEXT,
    "rejectionKgs" TEXT,
    "oilKgs" TEXT,
    "blackRejectionKgs" TEXT,
    "firstPassUncutKgs" TEXT,
    "finalUncutKgs" TEXT,
    "shellDust" TEXT,
    "shell" TEXT,
    "goodKernelsKgs" TEXT,
    "finalKernelsKgs" TEXT,
    "shotLbs" TEXT,
    "goodKernelsYield" TEXT,
    "finalRealisation" TEXT,
    "wholes" TEXT,
    "brokens" TEXT,
    "uncut" TEXT,
    "finalUncut" TEXT,
    "shell2" TEXT,
    "shellDust2" TEXT,

    CONSTRAINT "ShellingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShellingMachineSample" (
    "id" TEXT NOT NULL,
    "lotNo" TEXT,
    "date" TEXT,
    "week" TEXT,
    "shift" TEXT,
    "line" TEXT,
    "material" TEXT,
    "time" TEXT,
    "machineNo" TEXT,
    "sampleTime" TEXT,
    "sampleQtyG" TEXT,
    "wholesG" TEXT,
    "piecesG" TEXT,
    "edgeCutG" TEXT,
    "buttsG" TEXT,
    "knifeMarkG" TEXT,
    "uncutG" TEXT,
    "unscoopWholesG" TEXT,
    "unscoopPiecesG" TEXT,
    "shell" TEXT,
    "error" TEXT,
    "uncut" TEXT,
    "unscoop" TEXT,
    "totalKernelsG" TEXT,
    "knifeMark" TEXT,
    "edgecut" TEXT,
    "wholes" TEXT,
    "pieces" TEXT,

    CONSTRAINT "ShellingMachineSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShellingFrequencySample" (
    "id" TEXT NOT NULL,
    "lotNo" TEXT,
    "date" TEXT,
    "line" TEXT,
    "material" TEXT,
    "lotNumber" TEXT,
    "machineNo" TEXT,
    "perMinutes" TEXT,
    "perHour" TEXT,

    CONSTRAINT "ShellingFrequencySample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShellingLineRun" (
    "id" TEXT NOT NULL,
    "lotNo" TEXT,
    "line" TEXT,
    "size" TEXT,
    "inputQty" TEXT,
    "durationHrs" TEXT,
    "uncutQty" TEXT,
    "uncutDurationHrs" TEXT,
    "uncut" TEXT,
    "breakdownTimeMins" TEXT,
    "cuttingHrs" TEXT,
    "gapTime" TEXT,

    CONSTRAINT "ShellingLineRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShellWasteSample" (
    "id" TEXT NOT NULL,
    "lotNo" TEXT,
    "date" TEXT,
    "week" TEXT,
    "samplingPoint" TEXT,
    "sampleQtyG" TEXT,
    "wholeG" TEXT,
    "brokensG" TEXT,
    "rejectionG" TEXT,
    "unscoopG" TEXT,
    "uncutG" TEXT,
    "shellG" TEXT,
    "error" TEXT,
    "kernel" TEXT,
    "kernelLbs" TEXT,

    CONSTRAINT "ShellWasteSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KernelQualitySample" (
    "id" TEXT NOT NULL,
    "lotNo" TEXT,
    "date" TEXT,
    "week" TEXT,
    "shift" TEXT,
    "samplingPoint" TEXT,
    "sizes" TEXT,
    "sampleQtyG" TEXT,
    "nutCount" TEXT,
    "moisture" TEXT,
    "wholesG" TEXT,
    "brokensG" TEXT,
    "buttsG" TEXT,
    "backcutG" TEXT,
    "rejectionG" TEXT,
    "adheringMatterOilG" TEXT,
    "edgeCutG" TEXT,
    "uncut" TEXT,
    "unscoop" TEXT,
    "shellG" TEXT,
    "errorCheck" TEXT,
    "totalRejection" TEXT,
    "shell" TEXT,
    "knifeMark" TEXT,
    "wholes" TEXT,
    "brokens" TEXT,
    "edgecut" TEXT,

    CONSTRAINT "KernelQualitySample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BormaRun" (
    "id" TEXT NOT NULL,
    "lotNo" TEXT,
    "date" TEXT,
    "week" TEXT,
    "month" TEXT,
    "binNo" TEXT,
    "wholesKgs" TEXT,
    "piecesKgs" TEXT,
    "rejectionKgs" TEXT,
    "oilKgs" TEXT,
    "beforeBormaKgs" TEXT,
    "bkWholes" TEXT,
    "bkPieces" TEXT,
    "bkReject" TEXT,
    "bkOil" TEXT,
    "afterBormaKgs" TEXT,
    "loss" TEXT,
    "dryLoss" TEXT,

    CONSTRAINT "BormaRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BormaTrolleyRow" (
    "id" TEXT NOT NULL,
    "lotNo" TEXT,
    "slNo" TEXT,
    "date" TEXT,
    "week" TEXT,
    "month" TEXT,
    "bormaNo" TEXT,
    "binNo" TEXT,
    "material" TEXT,
    "trolleyNo" TEXT,
    "beforeBormaTrolleyWeightKgs" TEXT,
    "beforeBormaGrossWeightKgs" TEXT,
    "beforeBormaNetWeightOfKernelsKgs" TEXT,
    "afterBormaTrolleyWeightKgs" TEXT,
    "afterBormaGrossWeightKgs" TEXT,
    "afterBormaNetWeightOfKernelsKgs" TEXT,
    "loss" TEXT,
    "loss2" TEXT,

    CONSTRAINT "BormaTrolleyRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BormaMachineCycle" (
    "id" TEXT NOT NULL,
    "lotNo" TEXT,
    "slNo" TEXT,
    "date" TEXT,
    "week" TEXT,
    "month" TEXT,
    "sourceBin" TEXT,
    "binNo" TEXT,
    "bormaNo" TEXT,
    "bormaStartTime" TEXT,
    "bormaStopTime" TEXT,
    "runningHours" TEXT,
    "setPressureBar" TEXT,
    "cycle1TempDegC" TEXT,
    "cycle1TimeHrs" TEXT,
    "cycle2TempDegC" TEXT,
    "cycle2TimeHrs" TEXT,
    "cycle3TempDegC" TEXT,
    "cycle3TimeHrs" TEXT,
    "cycle4TempDegC" TEXT,
    "cycle4TimeHrs" TEXT,

    CONSTRAINT "BormaMachineCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinalOutputSample" (
    "id" TEXT NOT NULL,
    "lotNo" TEXT,
    "date" TEXT,
    "week" TEXT,
    "binNo" TEXT,
    "samplingPoint" TEXT,
    "shift" TEXT,
    "sampleQtyG" TEXT,
    "nutCount" TEXT,
    "moisture" TEXT,
    "goodKernelsG" TEXT,
    "piecesG" TEXT,
    "buttsG" TEXT,
    "scorchedG" TEXT,
    "spottedG" TEXT,
    "puk3G" TEXT,
    "shrivilledG" TEXT,
    "blemishG" TEXT,
    "dessertNwG" TEXT,
    "oilG" TEXT,
    "dirtyG" TEXT,
    "mechanicalDamage" TEXT,
    "rejectionG" TEXT,
    "huskG" TEXT,
    "total" TEXT,
    "goodKernels" TEXT,
    "pieces" TEXT,
    "scorched" TEXT,
    "spotted" TEXT,
    "shrivilledBlemished" TEXT,
    "dessert" TEXT,
    "adhetingDirtOil" TEXT,
    "rejection" TEXT,
    "husk" TEXT,

    CONSTRAINT "FinalOutputSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeelingPerformance" (
    "id" TEXT NOT NULL,
    "lotNo" TEXT,
    "date" TEXT,
    "unit" TEXT,
    "inputMaterial" TEXT,
    "ww" TEXT,
    "cw" TEXT,
    "sw" TEXT,
    "ssw" TEXT,
    "dw" TEXT,
    "puk1" TEXT,
    "puk2" TEXT,
    "puk3" TEXT,
    "ss" TEXT,
    "lp" TEXT,
    "dp" TEXT,
    "ow" TEXT,
    "dw2" TEXT,
    "fb" TEXT,
    "sb" TEXT,
    "fs" TEXT,
    "lwp" TEXT,
    "op" TEXT,
    "sp" TEXT,
    "rejection" TEXT,
    "ssp2" TEXT,
    "ktp" TEXT,
    "sp2" TEXT,
    "powder" TEXT,
    "totalQtyInKgs" TEXT,
    "noOfManpower" TEXT,
    "avgPerHead" TEXT,
    "recoverability" TEXT,

    CONSTRAINT "PeelingPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WasteDispatch" (
    "id" TEXT NOT NULL,
    "slNo" TEXT,
    "date" TEXT,
    "week" TEXT,
    "month" TEXT,
    "truckNo" TEXT,
    "weighmentSlip" TEXT,
    "tareWeight" TEXT,
    "grossWeight" TEXT,
    "netWeightKgs" TEXT,
    "vendor" TEXT,
    "category" TEXT,
    "priceHt" TEXT,
    "costType" TEXT,

    CONSTRAINT "WasteDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShellDispatch" (
    "id" TEXT NOT NULL,
    "slNo" TEXT,
    "date" TEXT,
    "week" TEXT,
    "month" TEXT,
    "truckNo" TEXT,
    "weighmentSlip" TEXT,
    "tareWeight" TEXT,
    "grossWeight" TEXT,
    "netWeightKgs" TEXT,
    "vendor" TEXT,

    CONSTRAINT "ShellDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoilerConsumption" (
    "id" TEXT NOT NULL,
    "slNo" TEXT,
    "date" TEXT,
    "week" TEXT,
    "month" TEXT,
    "material" TEXT,
    "qtyConsumedKgs" TEXT,

    CONSTRAINT "BoilerConsumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackingRecord" (
    "id" TEXT NOT NULL,
    "lotNo" TEXT,
    "date" TEXT,
    "grade" TEXT,
    "materialCode" TEXT,
    "sku" TEXT,
    "bin" TEXT,
    "qtyPacked" TEXT,
    "packedQtyInKgs" TEXT,
    "quantityDispatched" TEXT,
    "dispatchedQtyInKgs" TEXT,
    "contractNo" TEXT,
    "closingQtyInNos" TEXT,
    "status" TEXT,
    "aging" TEXT,
    "grouping" TEXT,
    "remarks" TEXT,

    CONSTRAINT "PackingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionLot_binNo_idx" ON "ProductionLot"("binNo");

-- CreateIndex
CREATE INDEX "BtmIntake_binNo_idx" ON "BtmIntake"("binNo");

-- CreateIndex
CREATE INDEX "BtmReceipt_btmNo_idx" ON "BtmReceipt"("btmNo");

-- CreateIndex
CREATE INDEX "BtmInputQuality_btmNo_idx" ON "BtmInputQuality"("btmNo");

-- CreateIndex
CREATE INDEX "BtmTallyRow_btmNo_idx" ON "BtmTallyRow"("btmNo");

-- CreateIndex
CREATE INDEX "CalibrationRun_btmNo_idx" ON "CalibrationRun"("btmNo");

-- CreateIndex
CREATE INDEX "SilosStockRow_binNo_idx" ON "SilosStockRow"("binNo");

-- CreateIndex
CREATE INDEX "WholesManualCalibration_binNo_idx" ON "WholesManualCalibration"("binNo");

-- CreateIndex
CREATE INDEX "CookingRun_lotNo_idx" ON "CookingRun"("lotNo");

-- CreateIndex
CREATE INDEX "ShellingRun_lotNo_idx" ON "ShellingRun"("lotNo");

-- CreateIndex
CREATE INDEX "ShellingMachineSample_lotNo_idx" ON "ShellingMachineSample"("lotNo");

-- CreateIndex
CREATE INDEX "ShellingFrequencySample_lotNo_idx" ON "ShellingFrequencySample"("lotNo");

-- CreateIndex
CREATE INDEX "ShellingLineRun_lotNo_idx" ON "ShellingLineRun"("lotNo");

-- CreateIndex
CREATE INDEX "ShellWasteSample_lotNo_idx" ON "ShellWasteSample"("lotNo");

-- CreateIndex
CREATE INDEX "KernelQualitySample_lotNo_idx" ON "KernelQualitySample"("lotNo");

-- CreateIndex
CREATE INDEX "BormaRun_lotNo_idx" ON "BormaRun"("lotNo");

-- CreateIndex
CREATE INDEX "BormaTrolleyRow_lotNo_idx" ON "BormaTrolleyRow"("lotNo");

-- CreateIndex
CREATE INDEX "BormaMachineCycle_lotNo_idx" ON "BormaMachineCycle"("lotNo");

-- CreateIndex
CREATE INDEX "FinalOutputSample_lotNo_idx" ON "FinalOutputSample"("lotNo");

-- CreateIndex
CREATE INDEX "PeelingPerformance_lotNo_idx" ON "PeelingPerformance"("lotNo");

-- CreateIndex
CREATE INDEX "PackingRecord_lotNo_idx" ON "PackingRecord"("lotNo");

-- AddForeignKey
ALTER TABLE "ProductionLot" ADD CONSTRAINT "ProductionLot_binNo_fkey" FOREIGN KEY ("binNo") REFERENCES "ProductionBin"("binNo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BtmIntake" ADD CONSTRAINT "BtmIntake_binNo_fkey" FOREIGN KEY ("binNo") REFERENCES "ProductionBin"("binNo") ON DELETE RESTRICT ON UPDATE CASCADE;

