-- Gives the Bins imported with no warehouse the one their own source file says, so each site's pickers offer only its
-- own bins (20 Nov 2026: a truck at Yakro was being offered Bouake's bins, and Lots at Bouake were put in Yakro's).
-- Read from the client's sheets, not guessed:
--   * "Bouake RCN Receiving at Factory Report": its BIN NO. column is where each truck was unloaded at Yakro
--     (BIN-001, BIN-02B ... — 413 of its 415 rows), so its BIN-* bins are YAKRO FACTORY's.
--   * Bouake's bins are written <store>-BIN-<n> (BKE-002-BIN-012) in the dispatch sheet and the APPLICATION VIEW:
--     they go to that store when it is in the master, else to BOUAKE.
-- Only bins with no warehouse are touched, and only when that warehouse exists here. Anything else (DIRECT-00x,
-- BKE-001-DRY, the store codes held as bins, bins with no source) stays unassigned and is reported by the
-- data-quality audit (bin_without_warehouse) for an admin to place in Masters > Bins.

UPDATE "Bin"
SET "warehouseName" = 'YAKRO FACTORY'
WHERE "warehouseName" IS NULL
  AND "code" LIKE 'BIN-%'
  AND "source" ILIKE '%Receiving at Factory Report%'
  AND EXISTS (SELECT 1 FROM "Warehouse" WHERE "name" = 'YAKRO FACTORY');

UPDATE "Bin" AS b
SET "warehouseName" = COALESCE(
  (SELECT w."name" FROM "Warehouse" w WHERE w."name" = substring(b."code" FROM '^(BKE-[0-9]{3})-BIN-') AND w."site" IS NOT NULL),
  (SELECT w."name" FROM "Warehouse" w WHERE w."name" = 'BOUAKE')
)
WHERE b."warehouseName" IS NULL
  AND b."code" ~ '^BKE-[0-9]{3}-BIN-';
