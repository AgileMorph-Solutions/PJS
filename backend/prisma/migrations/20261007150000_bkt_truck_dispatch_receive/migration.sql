-- One BKT = one truck. The truck and what leaves (dispatch) sit on the header; what arrives (bags,
-- gross weight, KOR, moisture, nut count) is a separate set of columns written only by the receiving
-- warehouse and blank until then. Variance and the in-transit / closed / discrepancy state are derived.

-- AlterTable
ALTER TABLE "TransferRequest" ADD COLUMN     "bagsReceived" INTEGER,
ADD COLUMN     "damagedBags" INTEGER,
ADD COLUMN     "dispatchedAt" TIMESTAMP(3),
ADD COLUMN     "dispatchedBy" TEXT,
ADD COLUMN     "dispatchedGrossKg" DECIMAL(65,30),
ADD COLUMN     "driver" TEXT,
ADD COLUMN     "driverPhone" TEXT,
ADD COLUMN     "korReceived" DECIMAL(65,30),
ADD COLUMN     "moistureReceived" DECIMAL(65,30),
ADD COLUMN     "nutCountReceived" INTEGER,
ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "receivedBy" TEXT,
ADD COLUMN     "receivedComment" TEXT,
ADD COLUMN     "receivedGrossKg" DECIMAL(65,30),
ADD COLUMN     "receivedLotNoRaw" TEXT,
ADD COLUMN     "transporter" TEXT,
ADD COLUMN     "truckNo" TEXT;

-- AlterTable
ALTER TABLE "TransferRequestLine" ADD COLUMN     "binCode" TEXT;

-- CreateIndex
CREATE INDEX "TransferRequest_truckNo_idx" ON "TransferRequest"("truckNo");

-- AddForeignKey
ALTER TABLE "TransferRequest" ADD CONSTRAINT "TransferRequest_dispatchedBy_fkey" FOREIGN KEY ("dispatchedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferRequest" ADD CONSTRAINT "TransferRequest_receivedBy_fkey" FOREIGN KEY ("receivedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

