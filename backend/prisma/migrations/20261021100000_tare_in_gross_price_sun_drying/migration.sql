-- Client change, Oct 2026.
--
-- 1. The tare (empty truck) reading moves into the gross weight step: it is recorded with the loaded reading on the
--    weighbridge, no longer as a step of its own after unloading. Every recorded value, its presence and its history move
--    with it; only the empty placeholder the 2026 import always created (a blank tare on every truck) has nowhere to go.
ALTER TABLE "StageGrossWeight" ADD COLUMN "tareWtKgs" TEXT, ADD COLUMN "tareWtKgsNum" DECIMAL(65,30);

INSERT INTO "StageGrossWeight" ("receiptId", "tareWtKgs", "tareWtKgsNum")
SELECT "receiptId", "tareWtKgs", "tareWtKgsNum" FROM "StageTareWeight"
WHERE "tareWtKgs" IS NOT NULL AND btrim("tareWtKgs") <> ''
ON CONFLICT ("receiptId") DO UPDATE SET "tareWtKgs" = EXCLUDED."tareWtKgs", "tareWtKgsNum" = EXCLUDED."tareWtKgsNum";

-- A truck whose only weighbridge record was the tare now has the gross weight step, from when the tare was first recorded.
INSERT INTO "StageEntry" ("receiptId", "stageId", "startedAt")
SELECT t."receiptId", 'n-gross', e."startedAt"
FROM "StageTareWeight" t JOIN "StageEntry" e ON e."receiptId" = t."receiptId" AND e."stageId" = 'n-tare'
WHERE t."tareWtKgs" IS NOT NULL AND btrim(t."tareWtKgs") <> ''
ON CONFLICT DO NOTHING;

UPDATE "StageFieldChange" SET "stageId" = 'n-gross' WHERE "stageId" = 'n-tare';
DELETE FROM "StageEntry" WHERE "stageId" = 'n-tare';

-- The round-trip oracle (each imported receipt's original stage JSON) follows the same move, so it keeps describing the record.
-- Every tare in it is the import's blank placeholder (checked: 0 of 986 hold a value), so the key simply goes.
UPDATE "Receipt"
SET "stageDataShadow" = (("stageDataShadow"::jsonb) - 'n-tare')::text
WHERE "stageDataShadow" IS NOT NULL AND ("stageDataShadow"::jsonb) ? 'n-tare';

DROP TABLE "StageTareWeight";

-- 2. The forklift destination is no longer recorded at unloading.
ALTER TABLE "StageUnload" DROP COLUMN "forkliftDestination";

-- 3. Sun drying in rounds, with a cut test before and after each round.
ALTER TABLE "DryingBatch"
  ADD COLUMN "round" INTEGER,
  ADD COLUMN "firstBatchId" TEXT,
  ADD COLUMN "inputGoodKernelG" DECIMAL(65,30),
  ADD COLUMN "inputImmatureG" DECIMAL(65,30),
  ADD COLUMN "inputSpottedG" DECIMAL(65,30),
  ADD COLUMN "inputRejectionG" DECIMAL(65,30),
  ADD COLUMN "inputVoidG" DECIMAL(65,30),
  ADD COLUMN "inputOilG" DECIMAL(65,30),
  ADD COLUMN "inputShellG" DECIMAL(65,30),
  ADD COLUMN "outputGoodKernelG" DECIMAL(65,30),
  ADD COLUMN "outputImmatureG" DECIMAL(65,30),
  ADD COLUMN "outputSpottedG" DECIMAL(65,30),
  ADD COLUMN "outputRejectionG" DECIMAL(65,30),
  ADD COLUMN "outputVoidG" DECIMAL(65,30),
  ADD COLUMN "outputOilG" DECIMAL(65,30),
  ADD COLUMN "outputShellG" DECIMAL(65,30),
  ADD COLUMN "returnedAt" TIMESTAMP(3),
  ADD COLUMN "checkedAt" TIMESTAMP(3),
  ADD COLUMN "startedBy" TEXT,
  ADD COLUMN "returnedBy" TEXT,
  ADD COLUMN "checkedBy" TEXT;

-- In-app drying recorded before rounds existed is round 1 of its own.
UPDATE "DryingBatch" SET "round" = 1 WHERE "source" = 'entered';
