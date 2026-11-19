-- "Reconditioning of torn bags" on the Unload step (the client's DISCHARGEMENT sheet's Recon Sacs): typed by the person.
-- The Tally Clerk bag count is calculated from it: good bags + reconditioned torn bags. Text like every stage column.
ALTER TABLE "StageUnload" ADD COLUMN "reconditionedTornBags" TEXT;
