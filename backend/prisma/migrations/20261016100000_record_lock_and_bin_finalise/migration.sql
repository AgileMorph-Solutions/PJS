-- Record locking (a truck's record locks when its GRN is complete) and the bin allocation date / finaliser.
-- Additive: nothing existing changes, and no existing receipt is locked.

ALTER TABLE "Receipt" ADD COLUMN "lockedAt" TIMESTAMP(3), ADD COLUMN "lockedById" TEXT;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StageBinAllocation" ADD COLUMN "allocationDate" TEXT, ADD COLUMN "finalisedBy" TEXT;
