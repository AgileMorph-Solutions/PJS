-- Client observations list, point 8. Empty jute bags received from another warehouse. What was received is a row of the
-- receiving warehouse's own stock ledger, so the running balance reads it with nothing added; this table holds only what that
-- ledger has no column for.
CREATE TABLE "JuteEmptyBagReceipt" (
    "id" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "fromWarehouse" TEXT NOT NULL,
    "responsibleParty" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JuteEmptyBagReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JuteEmptyBagReceipt_movementId_key" ON "JuteEmptyBagReceipt"("movementId");
CREATE INDEX "JuteEmptyBagReceipt_fromWarehouse_idx" ON "JuteEmptyBagReceipt"("fromWarehouse");

ALTER TABLE "JuteEmptyBagReceipt" ADD CONSTRAINT "JuteEmptyBagReceipt_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "JuteWarehouseMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JuteEmptyBagReceipt" ADD CONSTRAINT "JuteEmptyBagReceipt_fromWarehouse_fkey" FOREIGN KEY ("fromWarehouse") REFERENCES "Warehouse"("name") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JuteEmptyBagReceipt" ADD CONSTRAINT "JuteEmptyBagReceipt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every stock row naming a transfer used to count as bags going out, whichever way they moved. All three real ones are issues,
-- so their reading doesn't change; a row of bags RECEIVED under a transfer is the receiving side, and counts as coming in.
CREATE OR REPLACE VIEW "jute_movement_stream" AS
  -- Ledger 1: warehouse-level receipts and issues.
  SELECT m."whLocation"                              AS warehouse_name,
         to_char(COALESCE(m."movementDate", '1900-01-01'::timestamp), 'YYYY-MM') AS period,
         CASE
           WHEN m."activitiesType" = 'OPENING BALANCE' THEN 'OPENING'
           WHEN (m."activitiesType" ILIKE '%TRANSFF%' OR m."activitiesType" ILIKE '%TRANSFER%')
                AND COALESCE(m."bagsReceived", 0) > 0
             THEN 'TRANSFER_IN'
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
