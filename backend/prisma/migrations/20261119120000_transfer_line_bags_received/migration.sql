-- The bags of each Lot counted off a BKT at the receiving site. A truck is weighed once, so when it carries
-- several Lots (or part of a Lot split across trucks) these counts are what its net at arrival is shared by.
-- NULL on every BKT received before it was asked: no count is invented for them.
ALTER TABLE "TransferRequestLine" ADD COLUMN "bagsReceived" INTEGER;
