-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Lot uniqueness: one truck = one Lot, always.
--
-- A plain UNIQUE would treat every un-assigned receipt's '' as a collision, which is what forced
-- the old code to keep rewriting '' -> NULL before every write. A partial index says what we
-- actually mean — distinct among *assigned* lots only — and Prisma has no syntax for it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "StageLotAssignment_lotNumber_assigned_key"
  ON "StageLotAssignment" ("lotNumber")
  WHERE "lotNumber" IS NOT NULL AND "lotNumber" <> '';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Ledger 1 running balance.
--
-- The running balance is a VIEW, never a column. A generated column cannot express it (a running
-- total depends on every prior row, and GENERATED ALWAYS AS is strictly row-local); a CHECK
-- constraint would *reject* the real negative rows, which is the opposite of what we want; and a
-- materialized view would go stale the moment someone appends a row.
--
-- reported_balance is the workbook's own number, stored and never written by the application — it
-- genuinely reaches −11,027, and that survives verbatim. balance_delta is the flag: it is 0 for
-- all 298 imported rows, so a green view proves the import was faithful, and any future row that
-- disagrees with its own arithmetic lights up immediately.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIEW "jute_warehouse_movement_balance" AS
SELECT
  m.*,
  SUM(COALESCE(m."bagsReceived", 0) - COALESCE(m."bagsIssued", 0)) OVER (
    PARTITION BY m."whLocation" ORDER BY m."seq"
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS computed_balance,
  m."reportedBalance" - SUM(COALESCE(m."bagsReceived", 0) - COALESCE(m."bagsIssued", 0)) OVER (
    PARTITION BY m."whLocation" ORDER BY m."seq"
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS balance_delta
FROM "JuteWarehouseMovement" m;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Ledger 4 degeneracy flags.
--
-- DIFF equals −(Received Bags) on all 367 rows — a broken formula, not independent data. It is
-- stored verbatim (dropping it loses real client data; generating it would enshrine the bug) and
-- flagged here so /api/data-quality can report it as ONE aggregate finding rather than 367.
-- Note reportedDifference is the *real* column and is meaningful — the two are reported separately.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIEW "jute_transfer_receipt_flags" AS
SELECT
  t.*,
  (t."reportedDiff" IS NOT NULL AND t."bagsReceived" IS NOT NULL
     AND t."reportedDiff" = -t."bagsReceived")                        AS diff_is_degenerate,
  (t."reportedDifference" IS NOT NULL AND t."bagsReceived" IS NOT NULL
     AND t."bagsDispatched" IS NOT NULL
     AND t."reportedDifference" <> (t."bagsReceived" - t."bagsDispatched")) AS difference_mismatch
FROM "JuteWarehouseTransferReceipt" t;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Cross-ledger reconciliation:
--      opening + receipts + transfers in − issues − damaged/discarded − transfers out = closing
--
-- This is NOT expressible over ledger 1 alone — ledger 1 has no damaged/discarded column at all
-- (those three are gap columns). So all four ledgers project into one movement stream here.
--
-- Expect this to be UNBALANCED on the real data, correctly: ledger 1 records only 3 transfer-out
-- rows (~86,475 bags) while ledger 4 records 367 inbound transfers. That gap is invisible in the
-- client's current sheets and is reported as `transfer_out_undercounted`.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIEW "jute_movement_stream" AS
  -- Ledger 1: warehouse-level receipts and issues.
  SELECT m."whLocation"                              AS warehouse_name,
         to_char(COALESCE(m."movementDate", '1900-01-01'::timestamp), 'YYYY-MM') AS period,
         CASE
           WHEN m."activitiesType" ILIKE '%TRANSFF%' OR m."activitiesType" ILIKE '%TRANSFER%'
             THEN 'TRANSFER_OUT'
           WHEN COALESCE(m."bagsReceived", 0) > 0 THEN 'RECEIPT'
           ELSE 'ISSUE'
         END                                          AS movement_type,
         COALESCE(m."bagsReceived", 0) + COALESCE(m."bagsIssued", 0) AS qty,
         'warehouse-stock'                            AS ledger_id
    FROM "JuteWarehouseMovement" m
  UNION ALL
  -- Ledger 1: the gap columns, once anyone fills them.
  SELECT m."whLocation", to_char(COALESCE(m."movementDate", '1900-01-01'::timestamp), 'YYYY-MM'),
         'DAMAGED', COALESCE(m."completelyDamaged", 0), 'warehouse-stock'
    FROM "JuteWarehouseMovement" m WHERE m."completelyDamaged" IS NOT NULL
  UNION ALL
  -- Ledger 2: supplier movement.
  SELECT COALESCE(s."whLocation", '(unknown)'),
         to_char(COALESCE(s."movementDate", '1900-01-01'::timestamp), 'YYYY-MM'),
         'ISSUE', COALESCE(s."bagsIssuedToSupplier", 0), 'supplier-movement'
    FROM "JuteSupplierMovement" s
  UNION ALL
  SELECT COALESCE(s."whLocation", '(unknown)'),
         to_char(COALESCE(s."movementDate", '1900-01-01'::timestamp), 'YYYY-MM'),
         'RECEIPT', COALESCE(s."returnedViaDeliveries", 0), 'supplier-movement'
    FROM "JuteSupplierMovement" s
  UNION ALL
  -- Ledger 3: factory/production.
  SELECT COALESCE(p."whLocation", '(unknown)'),
         to_char(COALESCE(p."movementDate", '1900-01-01'::timestamp), 'YYYY-MM'),
         'ISSUE', COALESCE(p."issuedToProduction", 0), 'factory-production-tracking'
    FROM "JuteProductionMovement" p
  UNION ALL
  SELECT COALESCE(p."whLocation", '(unknown)'),
         to_char(COALESCE(p."movementDate", '1900-01-01'::timestamp), 'YYYY-MM'),
         'RECEIPT', COALESCE(p."returnedToWarehouse", 0), 'factory-production-tracking'
    FROM "JuteProductionMovement" p
  UNION ALL
  -- Ledger 4: a transfer reduces the source and increases the destination. Only the source side is
  -- named in the data (destination is implied by the sheet, never a column), so only TRANSFER_OUT
  -- is attributable to a warehouse here.
  SELECT t."sourceWarehouse", to_char(COALESCE(t."receivedDate", '1900-01-01'::timestamp), 'YYYY-MM'),
         'TRANSFER_OUT', COALESCE(t."bagsDispatched", 0), 'warehouse-to-warehouse-movement'
    FROM "JuteWarehouseTransferReceipt" t;

CREATE VIEW "jute_reconciliation" AS
SELECT
  warehouse_name,
  period,
  SUM(qty) FILTER (WHERE movement_type = 'OPENING')      AS opening,
  SUM(qty) FILTER (WHERE movement_type = 'RECEIPT')      AS receipts,
  SUM(qty) FILTER (WHERE movement_type = 'TRANSFER_IN')  AS transfers_in,
  SUM(qty) FILTER (WHERE movement_type = 'ISSUE')        AS issues,
  SUM(qty) FILTER (WHERE movement_type = 'DAMAGED')      AS damaged_or_discarded,
  SUM(qty) FILTER (WHERE movement_type = 'TRANSFER_OUT') AS transfers_out,
    COALESCE(SUM(qty) FILTER (WHERE movement_type = 'OPENING'), 0)
  + COALESCE(SUM(qty) FILTER (WHERE movement_type = 'RECEIPT'), 0)
  + COALESCE(SUM(qty) FILTER (WHERE movement_type = 'TRANSFER_IN'), 0)
  - COALESCE(SUM(qty) FILTER (WHERE movement_type = 'ISSUE'), 0)
  - COALESCE(SUM(qty) FILTER (WHERE movement_type = 'DAMAGED'), 0)
  - COALESCE(SUM(qty) FILTER (WHERE movement_type = 'TRANSFER_OUT'), 0) AS expected_closing
FROM "jute_movement_stream"
GROUP BY warehouse_name, period;
