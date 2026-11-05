-- Client trial observations, 02-11-2026, point 7. A warehouse's opening balance is the first row of its
-- own stock ledger, so the running balance starts from it with no second calculation: new rows take
-- the next seq upward, and an opening takes a seq below every other row, whenever it is entered.
CREATE TABLE "JuteOpeningBalance" (
    "id" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "remarks" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JuteOpeningBalance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JuteOpeningBalance_movementId_key" ON "JuteOpeningBalance"("movementId");

ALTER TABLE "JuteOpeningBalance" ADD CONSTRAINT "JuteOpeningBalance_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "JuteWarehouseMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JuteOpeningBalance" ADD CONSTRAINT "JuteOpeningBalance_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JuteOpeningBalance" ADD CONSTRAINT "JuteOpeningBalance_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A warehouse has one starting number. Prisma can't express a partial index, so it lives only here.
CREATE UNIQUE INDEX "JuteWarehouseMovement_one_opening_per_warehouse" ON "JuteWarehouseMovement"("whLocation")
  WHERE "activitiesType" = 'OPENING BALANCE';

-- jute_reconciliation has always had an opening column that nothing could fill. Only the CASE changes.
CREATE OR REPLACE VIEW "jute_movement_stream" AS
  -- Ledger 1: warehouse-level receipts and issues.
  SELECT m."whLocation"                              AS warehouse_name,
         to_char(COALESCE(m."movementDate", '1900-01-01'::timestamp), 'YYYY-MM') AS period,
         CASE
           WHEN m."activitiesType" = 'OPENING BALANCE' THEN 'OPENING'
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
