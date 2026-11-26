-- Bags of a transfer lot put back in a Bin instead of going on a truck (26 Nov 2026). The Bin's kg back is worked out from the
-- lot's weighing (its share by bags), so only the bags are stored.
CREATE TABLE "TransferLotReturn" (
    "id" SERIAL NOT NULL,
    "lotId" INTEGER NOT NULL,
    "binCode" TEXT NOT NULL,
    "bags" INTEGER NOT NULL,
    "returnDate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "TransferLotReturn_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TransferLotReturn_lotId_idx" ON "TransferLotReturn"("lotId");
CREATE INDEX "TransferLotReturn_binCode_idx" ON "TransferLotReturn"("binCode");

ALTER TABLE "TransferLotReturn" ADD CONSTRAINT "TransferLotReturn_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "TransferLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TransferLotReturn" ADD CONSTRAINT "TransferLotReturn_binCode_fkey" FOREIGN KEY ("binCode") REFERENCES "Bin"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TransferLotReturn" ADD CONSTRAINT "TransferLotReturn_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
