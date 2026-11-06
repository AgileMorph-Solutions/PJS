-- Production Phase 1, step 1 (RCN Receipt), from the client's "Phase 1 — Batch & Intake" document. New table only; nothing existing changes.

-- CreateTable
CREATE TABLE "RcnReceipt" (
    "id" TEXT NOT NULL,
    "batchCode" TEXT NOT NULL,
    "binCode" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "btmNo" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RcnReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RcnReceipt_batchCode_idx" ON "RcnReceipt"("batchCode");

-- CreateIndex
CREATE INDEX "RcnReceipt_batchCode_binCode_btmNo_idx" ON "RcnReceipt"("batchCode", "binCode", "btmNo");

-- AddForeignKey
ALTER TABLE "RcnReceipt" ADD CONSTRAINT "RcnReceipt_batchCode_binCode_fkey" FOREIGN KEY ("batchCode", "binCode") REFERENCES "ProductionBatchBin"("batchCode", "binCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcnReceipt" ADD CONSTRAINT "RcnReceipt_batchCode_fkey" FOREIGN KEY ("batchCode") REFERENCES "ProductionBatch"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcnReceipt" ADD CONSTRAINT "RcnReceipt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
