-- The receiving site's bin each Lot on a BKT was unloaded into, so a transferred Lot reaches production.
ALTER TABLE "TransferRequestLine" ADD COLUMN "receivedBinCode" TEXT;
