-- A transfer line may now be a Bin with no Lot (22 Nov 2026): a truck is loaded from Bins, since the Lots in a Bin can't
-- be told apart. Lines made per Lot keep their receipt. The foreign key and its RESTRICT stay as they were.
ALTER TABLE "TransferRequestLine" ALTER COLUMN "receiptId" DROP NOT NULL;
