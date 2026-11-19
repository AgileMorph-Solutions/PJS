-- Production accepts the warehouse's load (Lokesh, 16 Nov 2026, "Option 1"): from its acceptance the load's net is out of
-- the warehouse bin and net − dust − voids is in the silos.
ALTER TABLE "RcnReceipt" ADD COLUMN "acceptedById" TEXT;
ALTER TABLE "RcnReceipt" ADD COLUMN "acceptedAt" TIMESTAMP(3);

ALTER TABLE "RcnReceipt" ADD CONSTRAINT "RcnReceipt_acceptedById_fkey"
  FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A load whose final weight was saved before acceptance existed is already in the silos and already cooked from: it
-- counts as accepted at the moment it was finalised, so no silo balance moves. acceptedById stays NULL — nobody
-- accepted it in the app, and no one is named for it.
UPDATE "RcnReceipt" SET "acceptedAt" = "finalisedAt" WHERE "finalisedAt" IS NOT NULL;
