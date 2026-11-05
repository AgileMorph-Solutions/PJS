-- Client trial observations, 02-11-2026, point 7. Holds only what the warehouse stock ledger has no
-- column for: the bags, date and warehouse stay on the JuteWarehouseMovement row each entry creates.
CREATE TABLE "JuteVendorReceipt" (
    "id" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "deliveryNoteNo" TEXT NOT NULL,
    "invoicedQty" INTEGER NOT NULL,
    "remarks" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JuteVendorReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JuteVendorReceipt_movementId_key" ON "JuteVendorReceipt"("movementId");

ALTER TABLE "JuteVendorReceipt" ADD CONSTRAINT "JuteVendorReceipt_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "JuteWarehouseMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JuteVendorReceipt" ADD CONSTRAINT "JuteVendorReceipt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
