-- CreateTable
CREATE TABLE "Supplier" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "name" TEXT NOT NULL,
    "source" TEXT,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "Bin" (
    "code" TEXT NOT NULL,
    "warehouseName" TEXT,
    "source" TEXT,

    CONSTRAINT "Bin_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Origin" (
    "name" TEXT NOT NULL,
    "source" TEXT,

    CONSTRAINT "Origin_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "WarehouseAlias" (
    "alias" TEXT NOT NULL,
    "warehouseName" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "provenance" TEXT NOT NULL,

    CONSTRAINT "WarehouseAlias_pkey" PRIMARY KEY ("alias")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "arrivalDate" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "lbaCode" TEXT NOT NULL,
    "vehicleNo" TEXT NOT NULL,
    "warehouse" TEXT NOT NULL,
    "origin" TEXT,
    "stageDataShadow" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageEntry" (
    "receiptId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StageEntry_pkey" PRIMARY KEY ("receiptId","stageId")
);

-- CreateTable
CREATE TABLE "ReceiptBranch" (
    "receiptId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptBranch_pkey" PRIMARY KEY ("receiptId","stageId")
);

-- CreateTable
CREATE TABLE "TimelineEntry" (
    "id" SERIAL NOT NULL,
    "receiptId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "at" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "TimelineEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DryingJob" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "warehouse" TEXT NOT NULL,
    "bin" TEXT NOT NULL,
    "lotNo" TEXT NOT NULL,
    "ficheNo" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "dryType" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "moistureBefore" TEXT,
    "moistureAfter" TEXT,
    "quantityIssued" TEXT,
    "quantityReturned" TEXT,
    "driedStockBin" TEXT,
    "originLotNo" TEXT,

    CONSTRAINT "DryingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageDeliveryPlan" (
    "receiptId" TEXT NOT NULL,
    "supplierSource" TEXT,
    "expectedQtyOrTruckType" TEXT,
    "expectedArrivalDate" TEXT,
    "destinationWarehouse" TEXT,
    "plannedStatus" TEXT,

    CONSTRAINT "StageDeliveryPlan_pkey" PRIMARY KEY ("receiptId")
);

-- CreateTable
CREATE TABLE "StageGateEntry" (
    "receiptId" TEXT NOT NULL,
    "sn" TEXT,
    "dateOfArrival" TEXT,
    "rmFg" TEXT,
    "creditCash" TEXT,
    "whLocation" TEXT,
    "whNo" TEXT,
    "vehicleNo" TEXT,
    "warehouseType" TEXT,

    CONSTRAINT "StageGateEntry_pkey" PRIMARY KEY ("receiptId")
);

-- CreateTable
CREATE TABLE "StageVerifyDocs" (
    "receiptId" TEXT NOT NULL,
    "suppliersName" TEXT,
    "lbaCode" TEXT,
    "ficheCode" TEXT,
    "ref" TEXT,
    "fiche" TEXT,
    "origin" TEXT,

    CONSTRAINT "StageVerifyDocs_pkey" PRIMARY KEY ("receiptId")
);

-- CreateTable
CREATE TABLE "StageQualityQfs" (
    "receiptId" TEXT NOT NULL,
    "moisture" TEXT,
    "nutCount" TEXT,
    "kor" TEXT,
    "finalKor" TEXT,
    "moistureNum" DECIMAL(65,30),
    "nutCountNum" DECIMAL(65,30),
    "korNum" DECIMAL(65,30),
    "finalKorNum" DECIMAL(65,30),

    CONSTRAINT "StageQualityQfs_pkey" PRIMARY KEY ("receiptId")
);

-- CreateTable
CREATE TABLE "StageGrossWeight" (
    "receiptId" TEXT NOT NULL,
    "grossWtKgs" TEXT,
    "grossWtKgsNum" DECIMAL(65,30),

    CONSTRAINT "StageGrossWeight_pkey" PRIMARY KEY ("receiptId")
);

-- CreateTable
CREATE TABLE "StageLotAssignment" (
    "receiptId" TEXT NOT NULL,
    "lotNumber" TEXT,
    "truckReference" TEXT,
    "assignedBy" TEXT,
    "assignedAt" TEXT,

    CONSTRAINT "StageLotAssignment_pkey" PRIMARY KEY ("receiptId")
);

-- CreateTable
CREATE TABLE "StageBinAllocation" (
    "receiptId" TEXT NOT NULL,
    "binNumber" TEXT,
    "linkedLotNumbers" TEXT,
    "allocationBasis" TEXT,
    "finalisedWhen" TEXT,

    CONSTRAINT "StageBinAllocation_pkey" PRIMARY KEY ("receiptId")
);

-- CreateTable
CREATE TABLE "StageUnload" (
    "receiptId" TEXT NOT NULL,
    "dateOfOffloading" TEXT,
    "sacs" TEXT,
    "bonSacs" TEXT,
    "humidSacs" TEXT,
    "sacsDechires" TEXT,
    "refraction" TEXT,
    "manpowerContractor" TEXT,
    "tallyClerkBagCount" TEXT,
    "palletsUsed" TEXT,
    "forkliftDestination" TEXT,
    "sacsNum" DECIMAL(65,30),
    "bonSacsNum" DECIMAL(65,30),
    "humidSacsNum" DECIMAL(65,30),
    "sacsDechiresNum" DECIMAL(65,30),
    "refractionNum" DECIMAL(65,30),

    CONSTRAINT "StageUnload_pkey" PRIMARY KEY ("receiptId")
);

-- CreateTable
CREATE TABLE "StageTareWeight" (
    "receiptId" TEXT NOT NULL,
    "tareWtKgs" TEXT,
    "tareWtKgsNum" DECIMAL(65,30),

    CONSTRAINT "StageTareWeight_pkey" PRIMARY KEY ("receiptId")
);

-- CreateTable
CREATE TABLE "StageNetWeight" (
    "receiptId" TEXT NOT NULL,
    "netWtKgs" TEXT,
    "paidWt" TEXT,
    "netWtKgsNum" DECIMAL(65,30),
    "paidWtNum" DECIMAL(65,30),

    CONSTRAINT "StageNetWeight_pkey" PRIMARY KEY ("receiptId")
);

-- CreateTable
CREATE TABLE "StageGrn" (
    "receiptId" TEXT NOT NULL,
    "price" TEXT,
    "amount" TEXT,
    "grnWeight" TEXT,
    "priceNum" DECIMAL(65,30),
    "amountNum" DECIMAL(65,30),
    "grnWeightNum" DECIMAL(65,30),

    CONSTRAINT "StageGrn_pkey" PRIMARY KEY ("receiptId")
);

-- CreateTable
CREATE TABLE "StageStockUpdate" (
    "receiptId" TEXT NOT NULL,
    "stockLedgerEntry" TEXT,
    "warehouseType" TEXT,
    "currentStockBalance" TEXT,

    CONSTRAINT "StageStockUpdate_pkey" PRIMARY KEY ("receiptId")
);

-- CreateTable
CREATE TABLE "StageDryingDecision" (
    "receiptId" TEXT NOT NULL,
    "decision" TEXT,
    "moistureBefore" TEXT,
    "lotQtyIssued" TEXT,
    "moistureAfter" TEXT,
    "driedQtyReturned" TEXT,
    "driedStockBin" TEXT,
    "traceabilityRetained" TEXT,

    CONSTRAINT "StageDryingDecision_pkey" PRIMARY KEY ("receiptId")
);

-- CreateTable
CREATE TABLE "OtherActivity" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "rebagging" TEXT,
    "destacking" TEXT,
    "triage" TEXT,
    "movementBetweenLocations" TEXT,
    "linkedStockLot" TEXT,
    "linkedLocation" TEXT,

    CONSTRAINT "OtherActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLedgerEntry" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "activityType" TEXT,
    "occurredAt" TEXT,
    "quantity" TEXT,
    "location" TEXT,
    "linkedLotBin" TEXT,
    "performedBy" TEXT,

    CONSTRAINT "ActivityLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageTransferDecision" (
    "receiptId" TEXT NOT NULL,
    "decision" TEXT,
    "drivenBy" TEXT,

    CONSTRAINT "StageTransferDecision_pkey" PRIMARY KEY ("receiptId")
);

-- CreateTable
CREATE TABLE "StageRejection" (
    "receiptId" TEXT NOT NULL,
    "reason" TEXT,
    "statusNote" TEXT,

    CONSTRAINT "StageRejection_pkey" PRIMARY KEY ("receiptId")
);

-- CreateTable
CREATE TABLE "JuteWarehouseMovement" (
    "id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "sn" INTEGER,
    "sheetRow" INTEGER,
    "movementDate" TIMESTAMP(3),
    "rawDate" TEXT,
    "activitiesType" TEXT NOT NULL,
    "activityCategory" TEXT,
    "supplierCode" TEXT,
    "whLocation" TEXT NOT NULL,
    "truckNumber" TEXT,
    "wrNo" TEXT,
    "bagsIssued" INTEGER,
    "bagsReceived" INTEGER,
    "reportedBalance" INTEGER,
    "goodBagsAvailable" INTEGER,
    "completelyDamaged" INTEGER,
    "damagedRepairable" INTEGER,
    "receiptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JuteWarehouseMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JuteSupplierMovement" (
    "id" TEXT NOT NULL,
    "movementDate" TIMESTAMP(3),
    "supplierCode" TEXT NOT NULL,
    "whLocation" TEXT,
    "bagsIssuedToSupplier" INTEGER,
    "returnedViaDeliveries" INTEGER,
    "pendingWithSupplier" INTEGER,
    "damaged" INTEGER,
    "reusable" INTEGER,
    "activity" TEXT,
    "movementType" TEXT,
    "responsibleParty" TEXT,
    "receiptId" TEXT,
    "lotNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JuteSupplierMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JuteProductionMovement" (
    "id" TEXT NOT NULL,
    "movementDate" TIMESTAMP(3),
    "whLocation" TEXT,
    "department" TEXT,
    "issuedToProduction" INTEGER,
    "goodBagsRecovered" INTEGER,
    "completelyDamaged" INTEGER,
    "partiallyDamaged" INTEGER,
    "returnedToWarehouse" INTEGER,
    "closingBalance" INTEGER,
    "activity" TEXT,
    "movementType" TEXT,
    "responsibleParty" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JuteProductionMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JuteWarehouseTransferReceipt" (
    "id" TEXT NOT NULL,
    "sn" INTEGER NOT NULL,
    "receivedDate" TIMESTAMP(3),
    "rawDate" TEXT,
    "month" TEXT,
    "dryUndry" TEXT,
    "idTransfer" TEXT,
    "truckRegistration" TEXT,
    "lotNo" TEXT,
    "lotDry" TEXT,
    "noFiche" TEXT,
    "ccaFicheNumber" TEXT,
    "binNo" TEXT,
    "damagedBags" INTEGER,
    "newBagsUsed" INTEGER,
    "recondition" INTEGER,
    "sourceWarehouse" TEXT NOT NULL,
    "origin" TEXT,
    "bagsDispatched" INTEGER,
    "bagsReceived" INTEGER,
    "reportedDifference" INTEGER,
    "finalBagsAfterRebagging" INTEGER,
    "reportedDiff" INTEGER,
    "laissePasserEntree" TEXT,
    "fullyLoadedTruckWeight" INTEGER,
    "emptyTruckTareWeight" INTEGER,
    "grossWeightReceived" INTEGER,
    "netWeightAtArrival" INTEGER,
    "netWeightDispatched" INTEGER,
    "weightDifference" INTEGER,
    "korReceived" DECIMAL(65,30),
    "korReceivedRaw" TEXT,
    "korDispatched" DECIMAL(65,30),
    "korDispatchedRaw" TEXT,
    "moistureReceived" DECIMAL(65,30),
    "moistureReceivedRaw" TEXT,
    "moistureDispatched" DECIMAL(65,30),
    "moistureDispatchedRaw" TEXT,
    "ncArrival" TEXT,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JuteWarehouseTransferReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JuteTallySnapshot" (
    "id" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "sheet" TEXT,
    "capturedAt" TIMESTAMP(3),

    CONSTRAINT "JuteTallySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Receipt_warehouse_idx" ON "Receipt"("warehouse");

-- CreateIndex
CREATE INDEX "Receipt_supplierName_idx" ON "Receipt"("supplierName");

-- CreateIndex
CREATE INDEX "Receipt_arrivalDate_idx" ON "Receipt"("arrivalDate");

-- CreateIndex
CREATE INDEX "StageEntry_stageId_idx" ON "StageEntry"("stageId");

-- CreateIndex
CREATE INDEX "TimelineEntry_receiptId_idx" ON "TimelineEntry"("receiptId");

-- CreateIndex
CREATE INDEX "DryingJob_lotNo_idx" ON "DryingJob"("lotNo");

-- CreateIndex
CREATE INDEX "DryingJob_bin_idx" ON "DryingJob"("bin");

-- CreateIndex
CREATE INDEX "OtherActivity_receiptId_idx" ON "OtherActivity"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "OtherActivity_receiptId_seq_key" ON "OtherActivity"("receiptId", "seq");

-- CreateIndex
CREATE INDEX "ActivityLedgerEntry_receiptId_idx" ON "ActivityLedgerEntry"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityLedgerEntry_receiptId_seq_key" ON "ActivityLedgerEntry"("receiptId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "JuteWarehouseMovement_seq_key" ON "JuteWarehouseMovement"("seq");

-- CreateIndex
CREATE INDEX "JuteWarehouseMovement_whLocation_seq_idx" ON "JuteWarehouseMovement"("whLocation", "seq");

-- CreateIndex
CREATE INDEX "JuteWarehouseMovement_supplierCode_idx" ON "JuteWarehouseMovement"("supplierCode");

-- CreateIndex
CREATE INDEX "JuteWarehouseMovement_receiptId_idx" ON "JuteWarehouseMovement"("receiptId");

-- CreateIndex
CREATE INDEX "JuteSupplierMovement_supplierCode_idx" ON "JuteSupplierMovement"("supplierCode");

-- CreateIndex
CREATE INDEX "JuteSupplierMovement_receiptId_idx" ON "JuteSupplierMovement"("receiptId");

-- CreateIndex
CREATE INDEX "JuteProductionMovement_whLocation_idx" ON "JuteProductionMovement"("whLocation");

-- CreateIndex
CREATE UNIQUE INDEX "JuteWarehouseTransferReceipt_sn_key" ON "JuteWarehouseTransferReceipt"("sn");

-- CreateIndex
CREATE INDEX "JuteWarehouseTransferReceipt_sourceWarehouse_sn_idx" ON "JuteWarehouseTransferReceipt"("sourceWarehouse", "sn");

-- CreateIndex
CREATE INDEX "JuteWarehouseTransferReceipt_lotNo_idx" ON "JuteWarehouseTransferReceipt"("lotNo");

-- CreateIndex
CREATE INDEX "JuteWarehouseTransferReceipt_binNo_idx" ON "JuteWarehouseTransferReceipt"("binNo");

-- CreateIndex
CREATE UNIQUE INDEX "JuteTallySnapshot_ledgerId_label_key" ON "JuteTallySnapshot"("ledgerId", "label");

-- AddForeignKey
ALTER TABLE "WarehouseAlias" ADD CONSTRAINT "WarehouseAlias_warehouseName_fkey" FOREIGN KEY ("warehouseName") REFERENCES "Warehouse"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_warehouse_fkey" FOREIGN KEY ("warehouse") REFERENCES "Warehouse"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_origin_fkey" FOREIGN KEY ("origin") REFERENCES "Origin"("name") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageEntry" ADD CONSTRAINT "StageEntry_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptBranch" ADD CONSTRAINT "ReceiptBranch_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEntry" ADD CONSTRAINT "TimelineEntry_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageDeliveryPlan" ADD CONSTRAINT "StageDeliveryPlan_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageGateEntry" ADD CONSTRAINT "StageGateEntry_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageVerifyDocs" ADD CONSTRAINT "StageVerifyDocs_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageQualityQfs" ADD CONSTRAINT "StageQualityQfs_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageGrossWeight" ADD CONSTRAINT "StageGrossWeight_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageLotAssignment" ADD CONSTRAINT "StageLotAssignment_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageBinAllocation" ADD CONSTRAINT "StageBinAllocation_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageUnload" ADD CONSTRAINT "StageUnload_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageTareWeight" ADD CONSTRAINT "StageTareWeight_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageNetWeight" ADD CONSTRAINT "StageNetWeight_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageGrn" ADD CONSTRAINT "StageGrn_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageStockUpdate" ADD CONSTRAINT "StageStockUpdate_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageDryingDecision" ADD CONSTRAINT "StageDryingDecision_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtherActivity" ADD CONSTRAINT "OtherActivity_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLedgerEntry" ADD CONSTRAINT "ActivityLedgerEntry_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageTransferDecision" ADD CONSTRAINT "StageTransferDecision_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageRejection" ADD CONSTRAINT "StageRejection_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JuteWarehouseMovement" ADD CONSTRAINT "JuteWarehouseMovement_supplierCode_fkey" FOREIGN KEY ("supplierCode") REFERENCES "Supplier"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JuteWarehouseMovement" ADD CONSTRAINT "JuteWarehouseMovement_whLocation_fkey" FOREIGN KEY ("whLocation") REFERENCES "Warehouse"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JuteWarehouseTransferReceipt" ADD CONSTRAINT "JuteWarehouseTransferReceipt_sourceWarehouse_fkey" FOREIGN KEY ("sourceWarehouse") REFERENCES "Warehouse"("name") ON DELETE RESTRICT ON UPDATE CASCADE;
