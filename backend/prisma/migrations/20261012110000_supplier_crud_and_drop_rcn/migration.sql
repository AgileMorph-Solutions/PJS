-- Supplier CRUD (active flag, timestamps) and the client's request to drop "RCN" from supplier names.
--
-- Names are rewritten in the supplier master and in the copies the app itself writes (Receipt, its
-- Verify stage and shadow, Delivery Plan). The original goes to Supplier."formerName". Names kept
-- verbatim from the client's workbooks (drying, discharge, jute and other imported ledgers) are NOT
-- touched: they are a record of what the sheet said. Idempotent: a second run finds nothing to change.

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "formerName" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Supplier master: keep the original, then strip a leading RCN word (and the spaces after it).
UPDATE "Supplier" SET "formerName" = "name", "name" = btrim(regexp_replace("name", '^\s*RCN(\s+|$)', '', 'i'))
WHERE "name" ~* '^\s*RCN(\s+|$)';

UPDATE "Receipt" SET "supplierName" = btrim(regexp_replace("supplierName", '^\s*RCN(\s+|$)', '', 'i'))
WHERE "supplierName" ~* '^\s*RCN(\s+|$)';

UPDATE "StageVerifyDocs" SET "suppliersName" = btrim(regexp_replace("suppliersName", '^\s*RCN(\s+|$)', '', 'i'))
WHERE "suppliersName" ~* '^\s*RCN(\s+|$)';

UPDATE "DeliveryPlan" SET "supplierName" = btrim(regexp_replace("supplierName", '^\s*RCN(\s+|$)', '', 'i'))
WHERE "supplierName" ~* '^\s*RCN(\s+|$)';

-- The JSON copy of each receipt's stage data (what the round-trip test compares the live stages against).
UPDATE "Receipt" SET "stageDataShadow" = regexp_replace("stageDataShadow", '("SUPPLIERS NAME":")\s*RCN\s+', '\1', 'gi')
WHERE "stageDataShadow" ~* '"SUPPLIERS NAME":"\s*RCN\s+';
