-- Other warehouse activities recorded in the app: where (warehouse, from / to), triage's own checks, and who recorded it.
-- Additive and nullable: the 787 imported rows keep exactly what the sheet said, with these left empty.
ALTER TABLE "WarehouseActivityLedgerEntry"
  ADD COLUMN "warehouse" TEXT, ADD COLUMN "locationFrom" TEXT, ADD COLUMN "locationTo" TEXT,
  ADD COLUMN "moisturePct" DECIMAL(65,30), ADD COLUMN "quantityBeforeKg" DECIMAL(65,30), ADD COLUMN "quantityAfterKg" DECIMAL(65,30),
  ADD COLUMN "createdById" TEXT;
ALTER TABLE "WarehouseActivityLedgerEntry" ADD CONSTRAINT "WarehouseActivityLedgerEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
