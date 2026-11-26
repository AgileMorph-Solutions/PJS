-- A truck from the Unit warehouse is received through the same reception as a supplier truck (24 Nov 2026): one Receipt per
-- lot on the truck, linked to its BKT line. The separate per-lot arrival figures and the whole-truck rejection on the BKT
-- (20261124100000_transfer_lots) are replaced by that reception record, so their columns go.
ALTER TABLE "TransferRequestLine" DROP CONSTRAINT IF EXISTS "TransferRequestLine_received_counts_valid";
-- DropForeignKey
ALTER TABLE "TransferRequest" DROP CONSTRAINT "TransferRequest_rejectedBy_fkey";

-- DropIndex
DROP INDEX "TransferRequestLine_receivedLotNo_idx";

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "transferLineId" INTEGER;

-- AlterTable
ALTER TABLE "TransferRequest" DROP COLUMN "rejectedAt",
DROP COLUMN "rejectedBy",
DROP COLUMN "rejectedReason";

-- AlterTable
ALTER TABLE "TransferRequestLine" DROP COLUMN "damagedBagsReceived",
DROP COLUMN "korReceived",
DROP COLUMN "moistureReceived",
DROP COLUMN "nutCountReceived",
DROP COLUMN "receivedLotNo";

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_transferLineId_key" ON "Receipt"("transferLineId");

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_transferLineId_fkey" FOREIGN KEY ("transferLineId") REFERENCES "TransferRequestLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

