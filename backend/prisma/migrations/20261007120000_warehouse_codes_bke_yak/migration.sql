-- The client's APPLICATION VIEW workbook (Oct 2026) prints REC-BKE-2026-0001 and LOT-YAK-2026-0002:
-- the Bouaké code is BKE, not the BKE01 of their earlier email, and the factory's is YAK.
--
-- Only the codes move here. IDs already issued under BKE01 are moved by scripts/renumberIds.ts, which
-- keeps each number and records the old value (Receipt.legacyId holds the ORIGINAL REC-2026-NNNN id).
-- Until it has run, the ID issuers scan by site/kind/year across codes, so nothing is issued twice.
--
-- Both updates only touch the exact value they replace/fill, so an admin's own edit in
-- Masters › Warehouses is never overwritten.
UPDATE "Warehouse" SET "code" = 'BKE' WHERE "name" = 'BOUAKE' AND "site" IS NULL AND "code" = 'BKE01';
UPDATE "Warehouse" SET "code" = 'YAK' WHERE "name" = 'YAKRO FACTORY' AND "site" IS NULL AND "code" IS NULL;
