-- Delivery Plan pre-alert fields (origin, delivery window, expected trucks, funding reference,
-- destination store, planning basis, cancel) and the receipt-side exception approval / late link.
-- Status, progress and exception flags are derived (contract domain/deliveryPlan.ts), not stored.

-- AlterTable
ALTER TABLE "DeliveryPlan" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledBy" TEXT,
ADD COLUMN     "destinationStore" TEXT,
ADD COLUMN     "expectedDeliveryEnd" TEXT,
ADD COLUMN     "expectedOrigin" TEXT,
ADD COLUMN     "expectedTrucks" INTEGER,
ADD COLUMN     "fundingReference" TEXT,
ADD COLUMN     "planningBasis" TEXT;

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "deliveryPlanLinkedAt" TIMESTAMP(3),
ADD COLUMN     "exceptionApprovedAt" TIMESTAMP(3),
ADD COLUMN     "exceptionApprovedBy" TEXT,
ADD COLUMN     "exceptionNote" TEXT;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_exceptionApprovedBy_fkey" FOREIGN KEY ("exceptionApprovedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryPlan" ADD CONSTRAINT "DeliveryPlan_destinationStore_fkey" FOREIGN KEY ("destinationStore") REFERENCES "Warehouse"("name") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryPlan" ADD CONSTRAINT "DeliveryPlan_cancelledBy_fkey" FOREIGN KEY ("cancelledBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

