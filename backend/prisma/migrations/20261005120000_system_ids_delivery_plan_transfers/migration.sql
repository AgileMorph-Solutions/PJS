-- AlterTable
ALTER TABLE "DryingJob" ADD COLUMN     "lotNoRaw" TEXT;

-- AlterTable
ALTER TABLE "JuteSupplierMovement" ADD COLUMN     "lotNoRaw" TEXT;

-- AlterTable
ALTER TABLE "JuteWarehouseTransferReceipt" ADD COLUMN     "lotNoRaw" TEXT;

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "deliveryPlanId" TEXT,
ADD COLUMN     "legacyId" TEXT;

-- AlterTable
ALTER TABLE "StageGrossWeight" ADD COLUMN     "loadedTruckWtKgs" TEXT,
ADD COLUMN     "loadedTruckWtKgsNum" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "code" TEXT;

-- AlterTable
ALTER TABLE "WarehouseActivityLedgerEntry" ADD COLUMN     "lotNoRaw" TEXT;

-- AlterTable
ALTER TABLE "WarehouseDischarge" ADD COLUMN     "lotNoRaw" TEXT;

-- AlterTable
ALTER TABLE "WarehouseDispatchLine" ADD COLUMN     "vyogeNumberRaw" TEXT;

-- CreateTable
CREATE TABLE "DeliveryPlan" (
    "id" TEXT NOT NULL,
    "plannedDeliveryDate" TEXT,
    "supplierName" TEXT NOT NULL,
    "supplierCode" TEXT,
    "expectedQuantityKg" DECIMAL(65,30),
    "expectedTruckType" TEXT,
    "expectedArrivalDate" TEXT NOT NULL,
    "destinationWarehouse" TEXT NOT NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferRequest" (
    "id" TEXT NOT NULL,
    "transferDate" TEXT NOT NULL,
    "fromWarehouse" TEXT NOT NULL,
    "toWarehouse" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransferRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferRequestLine" (
    "id" SERIAL NOT NULL,
    "transferId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "bags" INTEGER,
    "netWeightKg" DECIMAL(65,30),

    CONSTRAINT "TransferRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryPlan_destinationWarehouse_expectedArrivalDate_idx" ON "DeliveryPlan"("destinationWarehouse", "expectedArrivalDate");

-- CreateIndex
CREATE INDEX "TransferRequest_fromWarehouse_idx" ON "TransferRequest"("fromWarehouse");

-- CreateIndex
CREATE INDEX "TransferRequest_toWarehouse_idx" ON "TransferRequest"("toWarehouse");

-- CreateIndex
CREATE INDEX "TransferRequestLine_receiptId_idx" ON "TransferRequestLine"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "TransferRequestLine_transferId_receiptId_key" ON "TransferRequestLine"("transferId", "receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_legacyId_key" ON "Receipt"("legacyId");

-- CreateIndex
CREATE INDEX "Receipt_deliveryPlanId_idx" ON "Receipt"("deliveryPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_deliveryPlanId_fkey" FOREIGN KEY ("deliveryPlanId") REFERENCES "DeliveryPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryPlan" ADD CONSTRAINT "DeliveryPlan_destinationWarehouse_fkey" FOREIGN KEY ("destinationWarehouse") REFERENCES "Warehouse"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferRequest" ADD CONSTRAINT "TransferRequest_fromWarehouse_fkey" FOREIGN KEY ("fromWarehouse") REFERENCES "Warehouse"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferRequest" ADD CONSTRAINT "TransferRequest_toWarehouse_fkey" FOREIGN KEY ("toWarehouse") REFERENCES "Warehouse"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferRequestLine" ADD CONSTRAINT "TransferRequestLine_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "TransferRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferRequestLine" ADD CONSTRAINT "TransferRequestLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- The one warehouse code the client has actually given (Oct 2026 team feedback, "REC-BKE01-2027-001").
-- Every other warehouse stays NULL until an admin enters its code in Masters › Warehouses — a
-- guessed code would be printed into every ID issued there and could never be taken back.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE "Warehouse" SET "code" = 'BKE01' WHERE "name" = 'BOUAKE' AND "code" IS NULL AND "site" IS NULL;
