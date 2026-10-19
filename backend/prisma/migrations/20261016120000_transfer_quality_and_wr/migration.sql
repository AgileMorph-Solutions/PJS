-- Dispatch carries each Lot's quality and the warehouse receipt number; receiving carries its own receipt number.
-- Additive and nullable: transfers that already happened keep what they had, with these left empty (nothing is invented).
ALTER TABLE "TransferRequestLine" ADD COLUMN "moisture" DECIMAL(65,30), ADD COLUMN "kor" DECIMAL(65,30), ADD COLUMN "nutCount" INTEGER;
ALTER TABLE "TransferRequest" ADD COLUMN "dispatchWhReceiptNo" TEXT, ADD COLUMN "receiveWhReceiptNo" TEXT;
