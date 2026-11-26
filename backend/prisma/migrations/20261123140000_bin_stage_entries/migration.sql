-- A Bin's own Other warehouse activities and Activity ledger forms (23 Nov 2026): the per-Lot steps n-otheract / n-ledger,
-- filled in for the Bin since warehouse activities moved to Bins.
CREATE TABLE "BinStageEntry" (
    "binCode" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enteredById" TEXT,
    "editedAt" TIMESTAMP(3) NOT NULL,
    "editedById" TEXT,

    CONSTRAINT "BinStageEntry_pkey" PRIMARY KEY ("binCode","stageId")
);

ALTER TABLE "BinStageEntry" ADD CONSTRAINT "BinStageEntry_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BinStageEntry" ADD CONSTRAINT "BinStageEntry_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
