-- Who uploaded which production workbook, when, and what it changed (team, 18 Nov 2026). One row per applied upload.
CREATE TABLE "ProductionWorkbookUpload" (
    "id" SERIAL NOT NULL,
    "warehouse" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT NOT NULL,
    "created" INTEGER NOT NULL,
    "updated" INTEGER NOT NULL,
    "tabs" JSONB NOT NULL,

    CONSTRAINT "ProductionWorkbookUpload_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductionWorkbookUpload_warehouse_uploadedAt_idx" ON "ProductionWorkbookUpload"("warehouse", "uploadedAt");

ALTER TABLE "ProductionWorkbookUpload" ADD CONSTRAINT "ProductionWorkbookUpload_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
