-- AlterTable
ALTER TABLE "BormaTrolleyRow" ADD COLUMN     "to" TEXT;

-- CreateTable
CREATE TABLE "OffloadingBinReport" (
    "id" TEXT NOT NULL,
    "binNo" TEXT,
    "ficheCca" TEXT,
    "origin" TEXT,
    "supplierName" TEXT,
    "qtyKgs" TEXT,
    "korLbs" TEXT,
    "goodKernelGm" TEXT,
    "immatureGm" TEXT,
    "spottedGm" TEXT,
    "rejectionGm" TEXT,
    "voidsGm" TEXT,
    "oilGm" TEXT,
    "moisture" TEXT,
    "nutCount" TEXT,

    CONSTRAINT "OffloadingBinReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WipStockRow" (
    "id" TEXT NOT NULL,
    "date" TEXT,
    "grade" TEXT,
    "type" TEXT,
    "from" TEXT,
    "to" TEXT,
    "binNo" TEXT,
    "qtyKgs" TEXT,

    CONSTRAINT "WipStockRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OffloadingBinReport_binNo_idx" ON "OffloadingBinReport"("binNo");

