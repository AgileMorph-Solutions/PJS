-- CreateIndex
CREATE INDEX "DryingJob_warehouse_idx" ON "DryingJob"("warehouse");

-- AddForeignKey
ALTER TABLE "DryingJob" ADD CONSTRAINT "DryingJob_warehouse_fkey" FOREIGN KEY ("warehouse") REFERENCES "Warehouse"("name") ON DELETE RESTRICT ON UPDATE CASCADE;
