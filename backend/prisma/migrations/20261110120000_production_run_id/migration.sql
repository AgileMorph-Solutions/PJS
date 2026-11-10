-- Every production run gets a system ID, like a truck's REC- receipt ID: PR-<warehouse code>-<start year>-NNN.
-- What used to be the run's key (a free-text name such as ANA-03B or BATCH-2) is kept as its `name`, so nothing a
-- person typed is lost and an uploaded workbook can still refer to the run by it.
ALTER TABLE "ProductionBatch" ADD COLUMN "name" TEXT;
CREATE UNIQUE INDEX "ProductionBatch_warehouse_name_key" ON "ProductionBatch"("warehouse", "name");

-- Hand-written data step (Prisma's DSL can't express it): renumber the existing runs. Numbered per warehouse and start
-- year in the order they were created, after any PR- ID already issued for that warehouse and year. Every foreign key
-- to ProductionBatch.code is ON UPDATE CASCADE (bins, RCN receipts, sizing checks, factory Lots follow the new ID).
-- A warehouse with no code can't issue an ID (same rule as REC-/LOT-/RR-), so its runs keep their key until an admin
-- sets one; nothing is guessed.
WITH named AS (
  SELECT b.code AS old_code,
         w.code AS wh_code,
         substr(b."startDate", 1, 4) AS yr,
         b.warehouse,
         row_number() OVER (PARTITION BY b.warehouse, substr(b."startDate", 1, 4) ORDER BY b."createdAt", b.code) AS n
  FROM "ProductionBatch" b
  JOIN "Warehouse" w ON w.name = b.warehouse
  WHERE b.code !~ '^PR-' AND w.code IS NOT NULL AND b."startDate" ~ '^\d{4}-'
),
offset_by AS (
  SELECT n.*,
         COALESCE((
           SELECT max(substring(p.code FROM '(\d+)$')::int)
           FROM "ProductionBatch" p
           WHERE p.warehouse = n.warehouse AND p.code LIKE 'PR-' || n.wh_code || '-' || n.yr || '-%'
         ), 0) AS base
  FROM named n
)
UPDATE "ProductionBatch" b
SET name = o.old_code,
    code = 'PR-' || o.wh_code || '-' || o.yr || '-' || lpad((o.base + o.n)::text, 3, '0')
FROM offset_by o
WHERE b.code = o.old_code;
