-- Production Phase 1, step 2 (Moisture check), from the client's "Phase 1 — Batch & Intake" document. New table only; nothing existing changes.

-- CreateTable
CREATE TABLE "RcnMoistureCheck" (
    "id" SERIAL NOT NULL,
    "rcnReceiptId" TEXT NOT NULL,
    "moisture" TEXT NOT NULL,
    "nutCount" TEXT NOT NULL,
    "sampleG" TEXT,
    "gkG" TEXT,
    "spotG" TEXT,
    "immatureG" TEXT,
    "oilG" TEXT,
    "rejectionG" TEXT,
    "voidsG" TEXT,
    "shellG" TEXT,
    "fruitWasteG" TEXT,
    "decision" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,

    CONSTRAINT "RcnMoistureCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RcnMoistureCheck_rcnReceiptId_idx" ON "RcnMoistureCheck"("rcnReceiptId");

-- AddForeignKey
ALTER TABLE "RcnMoistureCheck" ADD CONSTRAINT "RcnMoistureCheck_rcnReceiptId_fkey" FOREIGN KEY ("rcnReceiptId") REFERENCES "RcnReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcnMoistureCheck" ADD CONSTRAINT "RcnMoistureCheck_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcnMoistureCheck" ADD CONSTRAINT "RcnMoistureCheck_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

