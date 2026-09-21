-- CreateTable
CREATE TABLE "Supplier" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "name" TEXT NOT NULL PRIMARY KEY
);

-- CreateTable
CREATE TABLE "Bin" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "warehouseName" TEXT
);

-- CreateTable
CREATE TABLE "Origin" (
    "name" TEXT NOT NULL PRIMARY KEY
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "arrivalDate" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "lbaCode" TEXT NOT NULL,
    "vehicleNo" TEXT NOT NULL,
    "warehouse" TEXT NOT NULL,
    "origin" TEXT,
    "lotNo" TEXT,
    "binNo" TEXT,
    "stageData" TEXT NOT NULL DEFAULT '{}',
    "branches" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TimelineEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "receiptId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "at" TEXT NOT NULL,
    "note" TEXT,
    CONSTRAINT "TimelineEntry_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DryingJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "warehouse" TEXT NOT NULL,
    "bin" TEXT NOT NULL,
    "lotNo" TEXT NOT NULL,
    "ficheNo" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "dryType" TEXT NOT NULL,
    "destination" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "JuteLedgerEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ledgerId" TEXT NOT NULL,
    "row" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_lotNo_key" ON "Receipt"("lotNo");

-- CreateIndex
CREATE INDEX "Receipt_warehouse_idx" ON "Receipt"("warehouse");

-- CreateIndex
CREATE INDEX "Receipt_binNo_idx" ON "Receipt"("binNo");

-- CreateIndex
CREATE INDEX "Receipt_supplierName_idx" ON "Receipt"("supplierName");

-- CreateIndex
CREATE INDEX "TimelineEntry_receiptId_idx" ON "TimelineEntry"("receiptId");

-- CreateIndex
CREATE INDEX "DryingJob_lotNo_idx" ON "DryingJob"("lotNo");

-- CreateIndex
CREATE INDEX "DryingJob_bin_idx" ON "DryingJob"("bin");

-- CreateIndex
CREATE INDEX "JuteLedgerEntry_ledgerId_idx" ON "JuteLedgerEntry"("ledgerId");
