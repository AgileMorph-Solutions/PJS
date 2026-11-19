-- The crop year of a load, as the client's "1. RCN Receipts" register and "2. Input RCN Quality report" carry it.
-- Nullable: loads already recorded have none. The app never fills it in on its own; a person gives it (the Record a
-- load form offers the load's year, which they confirm or change).
ALTER TABLE "RcnReceipt" ADD COLUMN "cropYear" TEXT;
