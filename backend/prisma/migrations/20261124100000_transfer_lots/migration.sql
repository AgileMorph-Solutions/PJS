-- Transfer lots (24 Nov 2026): a Unit warehouse makes lots out of its Bins and loads trucks (BKTs) with them; the Central
-- warehouse receives each lot on the truck as its own lot, with its own Lot number, damaged bags and quality. A truck can
-- also be rejected there, and stays rejected.
-- AlterTable
ALTER TABLE "TransferRequest" ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedBy" TEXT,
ADD COLUMN     "rejectedReason" TEXT;

-- AlterTable
ALTER TABLE "TransferRequestLine" ADD COLUMN     "damagedBagsReceived" INTEGER,
ADD COLUMN     "korReceived" DECIMAL(65,30),
ADD COLUMN     "moistureReceived" DECIMAL(65,30),
ADD COLUMN     "nutCountReceived" INTEGER,
ADD COLUMN     "receivedLotNo" TEXT,
ADD COLUMN     "transferLotId" INTEGER;

-- CreateTable
CREATE TABLE "TransferLot" (
    "id" SERIAL NOT NULL,
    "lotNo" TEXT NOT NULL,
    "warehouse" TEXT NOT NULL,
    "lotDate" TEXT NOT NULL,
    "remarks" TEXT,
    "grossWeightKg" DECIMAL(65,30),
    "moisture" DECIMAL(65,30),
    "kor" DECIMAL(65,30),
    "nutCount" INTEGER,
    "weighedAt" TIMESTAMP(3),
    "weighedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransferLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferLotBin" (
    "id" SERIAL NOT NULL,
    "lotId" INTEGER NOT NULL,
    "binCode" TEXT NOT NULL,
    "bags" INTEGER NOT NULL,

    CONSTRAINT "TransferLotBin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransferLot_warehouse_lotNo_key" ON "TransferLot"("warehouse", "lotNo");

-- CreateIndex
CREATE INDEX "TransferLotBin_binCode_idx" ON "TransferLotBin"("binCode");

-- CreateIndex
CREATE UNIQUE INDEX "TransferLotBin_lotId_binCode_key" ON "TransferLotBin"("lotId", "binCode");

-- CreateIndex
CREATE INDEX "TransferRequestLine_transferLotId_idx" ON "TransferRequestLine"("transferLotId");

-- CreateIndex
CREATE INDEX "TransferRequestLine_receivedLotNo_idx" ON "TransferRequestLine"("receivedLotNo");

-- CreateIndex
CREATE UNIQUE INDEX "TransferRequestLine_transferId_transferLotId_key" ON "TransferRequestLine"("transferId", "transferLotId");

-- AddForeignKey
ALTER TABLE "TransferRequest" ADD CONSTRAINT "TransferRequest_rejectedBy_fkey" FOREIGN KEY ("rejectedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferRequestLine" ADD CONSTRAINT "TransferRequestLine_transferLotId_fkey" FOREIGN KEY ("transferLotId") REFERENCES "TransferLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLot" ADD CONSTRAINT "TransferLot_warehouse_fkey" FOREIGN KEY ("warehouse") REFERENCES "Warehouse"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLot" ADD CONSTRAINT "TransferLot_weighedBy_fkey" FOREIGN KEY ("weighedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLot" ADD CONSTRAINT "TransferLot_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLotBin" ADD CONSTRAINT "TransferLotBin_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "TransferLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLotBin" ADD CONSTRAINT "TransferLotBin_binCode_fkey" FOREIGN KEY ("binCode") REFERENCES "Bin"("code") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Not expressible in the Prisma DSL: the same "can't be right" values the forms and services refuse (contract
-- domain/transferLot.ts), held by the database too, so no other writer can store half a bag or a negative weight.
ALTER TABLE "TransferLotBin" ADD CONSTRAINT "TransferLotBin_bags_positive" CHECK ("bags" > 0);
ALTER TABLE "TransferLot" ADD CONSTRAINT "TransferLot_gross_positive" CHECK ("grossWeightKg" IS NULL OR "grossWeightKg" > 0);
ALTER TABLE "TransferLot" ADD CONSTRAINT "TransferLot_nutCount_positive" CHECK ("nutCount" IS NULL OR "nutCount" > 0);
ALTER TABLE "TransferRequestLine" ADD CONSTRAINT "TransferRequestLine_received_counts_valid"
  CHECK (("damagedBagsReceived" IS NULL OR "damagedBagsReceived" >= 0) AND ("nutCountReceived" IS NULL OR "nutCountReceived" > 0));
