-- Nov 2026 (client): "Final moisture (%)" and "Final nut count" are the truck's only moisture / nut
-- count; MOIS. and NUT COUNT go. Every 2026 truck holds its one reading in the old columns, so it is
-- carried across verbatim (French decimal commas, blanks and bad values included) before they drop.
-- Where a truck has both and they differ, the final reading is kept: the client's explicit choice,
-- and until now a recorded final reading overwrote MOIS. / NUT COUNT anyway.

ALTER TABLE "StageQualityQfs" RENAME COLUMN "moistureNum" TO "finalMoistureNum";
ALTER TABLE "StageQualityQfs" RENAME COLUMN "nutCountNum" TO "finalNutCountNum";

-- A truck that already has a final reading: its shadow must describe that reading, not the old one.
-- The same parse as stageStore.toNum: comma as decimal point, anything else unparseable is NULL.
UPDATE "StageQualityQfs" SET "finalMoistureNum" =
  CASE WHEN REPLACE(TRIM("finalMoisture"), ',', '.') ~ '^[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)$'
       THEN REPLACE(TRIM("finalMoisture"), ',', '.')::numeric END
WHERE COALESCE(TRIM("finalMoisture"), '') <> '';
UPDATE "StageQualityQfs" SET "finalNutCountNum" =
  CASE WHEN REPLACE(TRIM("finalNutCount"), ',', '.') ~ '^[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)$'
       THEN REPLACE(TRIM("finalNutCount"), ',', '.')::numeric END
WHERE COALESCE(TRIM("finalNutCount"), '') <> '';

UPDATE "StageQualityQfs" SET "finalMoisture" = "moisture"
WHERE "moisture" IS NOT NULL AND COALESCE(TRIM("finalMoisture"), '') = '';
UPDATE "StageQualityQfs" SET "finalNutCount" = "nutCount"
WHERE "nutCount" IS NOT NULL AND COALESCE(TRIM("finalNutCount"), '') = '';

ALTER TABLE "StageQualityQfs" DROP COLUMN "moisture", DROP COLUMN "nutCount";

-- A submission still awaiting review would fail on approval with labels that no longer exist. Reviewed
-- ones stay exactly as they were submitted: they are the record of what was sent.
UPDATE "FormSubmission"
SET "values" = jsonb_set(
  "values"::jsonb, '{n-qfs}',
  jsonb_strip_nulls(jsonb_build_object(
    'Final moisture (%)', "values"::jsonb -> 'n-qfs' -> 'MOIS. (moisture)',
    'Final nut count', "values"::jsonb -> 'n-qfs' -> 'NUT COUNT'
  )) || (("values"::jsonb -> 'n-qfs') - 'MOIS. (moisture)' - 'NUT COUNT')
)
WHERE "status" = 'submitted' AND "values"::jsonb -> 'n-qfs' ?| ARRAY['MOIS. (moisture)', 'NUT COUNT'];

-- Open and past upload warnings name the field they are about; keep them pointing at one that exists.
UPDATE "UploadIssue" SET "column" = 'Final moisture (%)' WHERE "column" = 'MOIS. (moisture)';

-- The golden round-trip test (tests/roundTrip.test.ts) compares every receipt to this snapshot, so it
-- has to speak the same labels. It is text, kept as text: only the two keys are renamed, nothing is reformatted.
UPDATE "Receipt"
SET "stageDataShadow" = REPLACE(REPLACE("stageDataShadow", '"MOIS. (moisture)"', '"Final moisture (%)"'), '"NUT COUNT"', '"Final nut count"')
WHERE "stageDataShadow" IS NOT NULL;
