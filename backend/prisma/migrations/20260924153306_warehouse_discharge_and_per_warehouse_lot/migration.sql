-- AlterTable
ALTER TABLE "StageLotAssignment" ADD COLUMN     "warehouseName" TEXT;

-- CreateTable
CREATE TABLE "WarehouseDischarge" (
    "sn" INTEGER NOT NULL,
    "warehouseSite" TEXT,
    "warehouse" TEXT,
    "unloadingBin" TEXT,
    "afterDryingBin" TEXT,
    "lotNo" TEXT NOT NULL,
    "scaleLocation" TEXT,
    "whReceiptNo" TEXT,
    "ficheCca" TEXT NOT NULL,
    "truckNo" TEXT,
    "arrivalDate" TIMESTAMP(3),
    "dischargeDate" TIMESTAMP(3),
    "origin" TEXT,
    "supplierName" TEXT,
    "supplierCode" TEXT,
    "bonSacs" INTEGER,
    "humidSacs" INTEGER,
    "tornSacs" INTEGER,
    "reconSacs" INTEGER,
    "totalSacsLot" INTEGER,
    "sacsExports" INTEGER,
    "sacsBio" INTEGER,
    "sacsBrousses" INTEGER,
    "totalRecd" INTEGER,
    "grossWtRecd" DECIMAL(65,30),
    "totalRefraction" DECIMAL(65,30),
    "grnQty" DECIMAL(65,30),
    "weightPaid" DECIMAL(65,30),
    "netWeight" DECIMAL(65,30),
    "diff" DECIMAL(65,30),
    "grnFreshQty" DECIMAL(65,30),
    "grnDriedQty" DECIMAL(65,30),
    "samplingBrowns" DECIMAL(65,30),
    "samplingVoids" DECIMAL(65,30),
    "samplingOil" DECIMAL(65,30),
    "samplingTotDefect" DECIMAL(65,30),
    "samplingGoodKernel" DECIMAL(65,30),
    "samplingImmature" DECIMAL(65,30),
    "samplingSpotted" DECIMAL(65,30),
    "samplingTotKernels" DECIMAL(65,30),
    "samplingKor" DECIMAL(65,30),
    "samplingShot" DECIMAL(65,30),
    "samplingFot" DECIMAL(65,30),
    "samplingUsefulKernelsYield" DECIMAL(65,30),
    "samplingTotalYield" DECIMAL(65,30),
    "samplingMoisture" DECIMAL(65,30),
    "samplingNc" DECIMAL(65,30),
    "samplingShell" DECIMAL(65,30),
    "finalOffloadBrowns" DECIMAL(65,30),
    "finalOffloadVoids" DECIMAL(65,30),
    "finalOffloadOil" DECIMAL(65,30),
    "finalOffloadTotDefect" DECIMAL(65,30),
    "finalOffloadGoodKernel" DECIMAL(65,30),
    "finalOffloadImmature" DECIMAL(65,30),
    "finalOffloadSpotted" DECIMAL(65,30),
    "finalOffloadTotKernels" DECIMAL(65,30),
    "finalOffloadKor" DECIMAL(65,30),
    "finalOffloadShot" DECIMAL(65,30),
    "finalOffloadFot" DECIMAL(65,30),
    "finalOffloadUsefulKernelsYield" DECIMAL(65,30),
    "finalOffloadTotalYield" DECIMAL(65,30),
    "finalOffloadMoisture" DECIMAL(65,30),
    "finalOffloadNc" DECIMAL(65,30),
    "finalOffloadShell" DECIMAL(65,30),
    "sheetRow" INTEGER,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseDischarge_pkey" PRIMARY KEY ("lotNo")
);

-- CreateIndex
CREATE INDEX "WarehouseDischarge_ficheCca_idx" ON "WarehouseDischarge"("ficheCca");

-- CreateIndex
CREATE INDEX "WarehouseDischarge_warehouse_idx" ON "WarehouseDischarge"("warehouse");

-- CreateIndex
CREATE INDEX "StageLotAssignment_warehouseName_lotNumber_idx" ON "StageLotAssignment"("warehouseName", "lotNumber");

-- Lot uniqueness becomes PER WAREHOUSE.
--
-- The original index (added in 20260921132438_lot_unique_and_jute_views) enforced "one truck = one
-- Lot" globally. That held only while no receipt had a lot at all. The client's own sheets number
-- lots per site — the same truck is Lot 17 at Bouaké and Lot 20 at Yakro, and 334 of 339
-- fiche-matched rows disagree — so every warehouse restarts at 1 and a global index would reject
-- the second site's Lot 1 as a duplicate of the first site's.
--
-- Still partial, for the same reason as before: a plain UNIQUE would treat every un-assigned
-- receipt's '' as a collision. Prisma has no syntax for either the partial predicate or this
-- composite, so it stays raw SQL.
DROP INDEX IF EXISTS "StageLotAssignment_lotNumber_assigned_key";

CREATE UNIQUE INDEX "StageLotAssignment_warehouse_lotNumber_assigned_key"
  ON "StageLotAssignment" ("warehouseName", "lotNumber")
  WHERE "lotNumber" IS NOT NULL AND "lotNumber" <> '';
