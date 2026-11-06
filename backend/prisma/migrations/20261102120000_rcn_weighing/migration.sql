-- Production Phase 1, steps 3–4 (Weigh pallets, Final weight), from the client's "19. RCN Receipts Tally Sheet" (form ANGR-PG-FRM-025). New tables and nullable columns only; nothing existing changes.

-- AlterTable
ALTER TABLE "RcnReceipt" ADD COLUMN     "dustKg" TEXT,
ADD COLUMN     "finalisedAt" TIMESTAMP(3),
ADD COLUMN     "finalisedById" TEXT,
ADD COLUMN     "voidsKg" TEXT;

-- CreateTable
CREATE TABLE "RcnPallet" (
    "id" SERIAL NOT NULL,
    "rcnReceiptId" TEXT NOT NULL,
    "grossKg" TEXT NOT NULL,
    "bags" TEXT NOT NULL,
    "factoryBin" TEXT NOT NULL,
    "weighedById" TEXT NOT NULL,
    "weighedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RcnPallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RcnEmptyPalletStack" (
    "id" SERIAL NOT NULL,
    "rcnReceiptId" TEXT NOT NULL,
    "weightKg" TEXT NOT NULL,
    "count" TEXT,

    CONSTRAINT "RcnEmptyPalletStack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RcnPallet_rcnReceiptId_idx" ON "RcnPallet"("rcnReceiptId");

-- CreateIndex
CREATE INDEX "RcnEmptyPalletStack_rcnReceiptId_idx" ON "RcnEmptyPalletStack"("rcnReceiptId");

-- AddForeignKey
ALTER TABLE "RcnReceipt" ADD CONSTRAINT "RcnReceipt_finalisedById_fkey" FOREIGN KEY ("finalisedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcnPallet" ADD CONSTRAINT "RcnPallet_rcnReceiptId_fkey" FOREIGN KEY ("rcnReceiptId") REFERENCES "RcnReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcnPallet" ADD CONSTRAINT "RcnPallet_weighedById_fkey" FOREIGN KEY ("weighedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcnEmptyPalletStack" ADD CONSTRAINT "RcnEmptyPalletStack_rcnReceiptId_fkey" FOREIGN KEY ("rcnReceiptId") REFERENCES "RcnReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

