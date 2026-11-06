-- The transfer form now offers the stores listed in Masters. toWarehouse stays the store's site, since access and
-- receiving are decided by site, so the store itself needs its own column. Existing transfers stay null: they named no store.
ALTER TABLE "TransferRequest" ADD COLUMN "toStore" TEXT;
