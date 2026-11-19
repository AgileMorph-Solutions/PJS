-- "6. Cooking Process Report": the kg damaged or spoiled in the cooker (power cuts, breakdowns), as typed.
ALTER TABLE "LotCookRun" ADD COLUMN "damagedKg" TEXT;

-- The check after the cooker (QC-3) is no longer done (Nov 2026). Its records, if any, would name a kind the app no
-- longer knows.
DELETE FROM "LotEntry" WHERE "kind" = 'qc3';
