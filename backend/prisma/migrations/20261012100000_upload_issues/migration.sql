-- Soft problems found in uploaded workbook rows, kept against the truck they came from so they show on
-- its details page. Additive: nothing existing changes. See contract domain/uploadChecks.ts.

-- CreateTable
CREATE TABLE "UploadIssue" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "sheet" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "column" TEXT,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,

    CONSTRAINT "UploadIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UploadIssue_receiptId_idx" ON "UploadIssue"("receiptId");

-- CreateIndex
CREATE INDEX "UploadIssue_reviewedAt_idx" ON "UploadIssue"("reviewedAt");

-- AddForeignKey
ALTER TABLE "UploadIssue" ADD CONSTRAINT "UploadIssue_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadIssue" ADD CONSTRAINT "UploadIssue_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadIssue" ADD CONSTRAINT "UploadIssue_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
