-- The weight of bags put back in a Bin, as weighed (26 Nov 2026). Nullable: a put-back from before keeps its share by bags.
ALTER TABLE "TransferLotReturn" ADD COLUMN "netWeightKg" DECIMAL(65,30);
