-- A Bin's Other warehouse activities and Activity ledger become ledgers (26 Nov 2026): many entries per Bin, not one form each.
CREATE TABLE "BinActivityEntry" (
    "id" SERIAL NOT NULL,
    "binCode" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enteredById" TEXT,
    "editedAt" TIMESTAMP(3) NOT NULL,
    "editedById" TEXT,

    CONSTRAINT "BinActivityEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BinActivityEntry_binCode_stageId_idx" ON "BinActivityEntry"("binCode", "stageId");

ALTER TABLE "BinActivityEntry" ADD CONSTRAINT "BinActivityEntry_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BinActivityEntry" ADD CONSTRAINT "BinActivityEntry_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Each Bin's one form of each becomes its first entry, with who entered and last changed it and when: nothing is dropped.
INSERT INTO "BinActivityEntry" ("binCode", "stageId", "values", "enteredAt", "enteredById", "editedAt", "editedById")
SELECT "binCode", "stageId", "values", "enteredAt", "enteredById", "editedAt", "editedById"
FROM "BinStageEntry"
WHERE "stageId" IN ('n-otheract', 'n-ledger')
ORDER BY "enteredAt";

DELETE FROM "BinStageEntry" WHERE "stageId" IN ('n-otheract', 'n-ledger');
