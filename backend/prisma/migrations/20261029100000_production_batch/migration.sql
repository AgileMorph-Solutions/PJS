-- Production Phase 0 (Batch), from the client's "Phase 1 — Batch & Intake" document. New tables only; nothing existing changes.

-- CreateTable
CREATE TABLE "ProductionBatch" (
    "code" TEXT NOT NULL,
    "warehouse" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "proposedBy" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionBatch_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ProductionBatchBin" (
    "batchCode" TEXT NOT NULL,
    "binCode" TEXT NOT NULL,
    "plannedKg" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "ProductionBatchBin_pkey" PRIMARY KEY ("batchCode","binCode")
);

-- CreateIndex
CREATE INDEX "ProductionBatch_warehouse_idx" ON "ProductionBatch"("warehouse");

-- CreateIndex
CREATE INDEX "ProductionBatchBin_binCode_idx" ON "ProductionBatchBin"("binCode");

-- AddForeignKey
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_warehouse_fkey" FOREIGN KEY ("warehouse") REFERENCES "Warehouse"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatchBin" ADD CONSTRAINT "ProductionBatchBin_batchCode_fkey" FOREIGN KEY ("batchCode") REFERENCES "ProductionBatch"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatchBin" ADD CONSTRAINT "ProductionBatchBin_binCode_fkey" FOREIGN KEY ("binCode") REFERENCES "Bin"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

