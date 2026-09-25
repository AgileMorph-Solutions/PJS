-- AlterTable
ALTER TABLE "JuteWarehouseTransferReceipt" ADD COLUMN     "destinationProvenance" TEXT,
ADD COLUMN     "destinationWarehouse" TEXT;

-- CreateIndex
CREATE INDEX "JuteWarehouseTransferReceipt_destinationWarehouse_idx" ON "JuteWarehouseTransferReceipt"("destinationWarehouse");

-- AddForeignKey
ALTER TABLE "JuteWarehouseTransferReceipt" ADD CONSTRAINT "JuteWarehouseTransferReceipt_destinationWarehouse_fkey" FOREIGN KEY ("destinationWarehouse") REFERENCES "Warehouse"("name") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7th UNION arm: ledger 4's inbound side. Until now only TRANSFER_OUT (the source side) was
-- attributable to a warehouse — destinationWarehouse now makes TRANSFER_IN attributable too, which
-- populates jute_reconciliation's transfers_in column for the first time. Order matters here:
-- jute_reconciliation depends on jute_movement_stream, so it must be dropped first and recreated
-- last, or the CREATE OR REPLACE below is rejected for changing a view another view depends on.
-- ─────────────────────────────────────────────────────────────────────────────
DROP VIEW "jute_reconciliation";

CREATE OR REPLACE VIEW "jute_movement_stream" AS
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
  -- Ledger 4: a transfer reduces the source and increases the destination.
  SELECT t."sourceWarehouse", to_char(COALESCE(t."receivedDate", '1900-01-01'::timestamp), 'YYYY-MM'),
         'TRANSFER_OUT', COALESCE(t."bagsDispatched", 0), 'warehouse-to-warehouse-movement'
    FROM "JuteWarehouseTransferReceipt" t
  UNION ALL
  -- Ledger 4, inbound side: only rows with a known destination are attributable — a row whose
  -- destination is still unresolved (none exist today, but a future sheet variant could omit the
  -- header cue) is left out here and would surface as a data-quality finding instead. Preserve the
  -- asymmetry deliberately: OUT is measured by bagsDispatched, IN by bagsReceived — they genuinely
  -- differ (see JuteWarehouseTransferReceipt.reportedDifference), so this is not a copy of the row
  -- above with the sign flipped.
  SELECT t."destinationWarehouse", to_char(COALESCE(t."receivedDate", '1900-01-01'::timestamp), 'YYYY-MM'),
         'TRANSFER_IN', COALESCE(t."bagsReceived", 0), 'warehouse-to-warehouse-movement'
    FROM "JuteWarehouseTransferReceipt" t
   WHERE t."destinationWarehouse" IS NOT NULL;

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
