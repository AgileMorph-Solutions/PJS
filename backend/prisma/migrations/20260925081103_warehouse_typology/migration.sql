-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "kind" TEXT,
ADD COLUMN     "site" TEXT;

-- CreateIndex
CREATE INDEX "Warehouse_kind_idx" ON "Warehouse"("kind");

-- CreateIndex
CREATE INDEX "Warehouse_site_idx" ON "Warehouse"("site");

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_site_fkey" FOREIGN KEY ("site") REFERENCES "Warehouse"("name") ON DELETE SET NULL ON UPDATE CASCADE;
