-- Production Phase 2 (Calibration), from the client's "Production module" document and its workbooks 4. Calibration Process report, 5. Calibrated RCN Silos Stock report and 24. Wholes Manual Calibration. New tables only; nothing existing changes.

-- CreateTable
CREATE TABLE "RcnCalibrationRun" (
    "id" SERIAL NOT NULL,
    "rcnReceiptId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "kgApp" TEXT,
    "kgAp" TEXT,
    "kgA" TEXT,
    "kgAB" TEXT,
    "kgB" TEXT,
    "kgBC" TEXT,
    "kgC" TEXT,
    "kgD" TEXT,
    "kgE" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RcnCalibrationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SizingCheck" (
    "id" SERIAL NOT NULL,
    "batchCode" TEXT NOT NULL,
    "binCode" TEXT,
    "date" TEXT NOT NULL,
    "point" TEXT NOT NULL,
    "nutCount" TEXT,
    "sampleG" TEXT NOT NULL,
    "gApp" TEXT,
    "gAp" TEXT,
    "gA" TEXT,
    "gAB" TEXT,
    "gB" TEXT,
    "gBC" TEXT,
    "gC" TEXT,
    "gD" TEXT,
    "gE" TEXT,
    "gUnder" TEXT,
    "decision" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,

    CONSTRAINT "SizingCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualCalibration" (
    "id" SERIAL NOT NULL,
    "sizingCheckId" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "fromSize" TEXT NOT NULL,
    "toSize" TEXT NOT NULL,
    "kg" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualCalibration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RcnCalibrationRun_rcnReceiptId_idx" ON "RcnCalibrationRun"("rcnReceiptId");

-- CreateIndex
CREATE INDEX "SizingCheck_batchCode_idx" ON "SizingCheck"("batchCode");

-- CreateIndex
CREATE INDEX "ManualCalibration_sizingCheckId_idx" ON "ManualCalibration"("sizingCheckId");

-- AddForeignKey
ALTER TABLE "RcnCalibrationRun" ADD CONSTRAINT "RcnCalibrationRun_rcnReceiptId_fkey" FOREIGN KEY ("rcnReceiptId") REFERENCES "RcnReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcnCalibrationRun" ADD CONSTRAINT "RcnCalibrationRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SizingCheck" ADD CONSTRAINT "SizingCheck_batchCode_fkey" FOREIGN KEY ("batchCode") REFERENCES "ProductionBatch"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SizingCheck" ADD CONSTRAINT "SizingCheck_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SizingCheck" ADD CONSTRAINT "SizingCheck_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualCalibration" ADD CONSTRAINT "ManualCalibration_sizingCheckId_fkey" FOREIGN KEY ("sizingCheckId") REFERENCES "SizingCheck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualCalibration" ADD CONSTRAINT "ManualCalibration_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

