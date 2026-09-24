-- ─────────────────────────────────────────────────────────────────────────────
-- Production stock is a VIEW, never a column — same reasoning as
-- jute_warehouse_movement_balance (20260921132438_lot_unique_and_jute_views): a running balance
-- depends on every prior row, so it can't be a GENERATED column, and the real sheets' own
-- Opening/Closing Stock cells are marked unreliable by the flow map itself (Production.html's
-- PAYLOAD marks both "3. RCN Stock Report.xlsx"'s and "5. Calibrated RCN Silos Stock
-- report.xlsx"'s opening/closing columns `now: false`) — computing it here means there is nothing
-- stored that can drift from the receipts/issues it is derived from.
--
-- Caveat carried over verbatim from the jute views: `date` on every production table is a String
-- column (see schema header note 2 — everything is String, same round-trip reasons as stage
-- fields), ordered here as text. The real sheets are >99% ISO-prefixed ("2026-04-23...") so text
-- order matches chronological order for the vast majority of rows; a handful of hand-typed
-- DD-MM-YYYY cells (the same class of defect jute's rawDate handling exists for) would sort out of
-- place. Not silently fixed — a mis-ordered run would show up as a nonsensical balance swing, which
-- is itself the signal, not something to mask with a parsing shortcut that might guess wrong.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE VIEW "production_bin_movement" AS
SELECT
  "binNo",
  "date",
  "receivedGrossQtyKgs"::numeric AS qty_in,
  0::numeric                     AS qty_out,
  'received'                     AS movement_type,
  "id"                           AS source_id
FROM "BtmReceipt"
WHERE "binNo" IS NOT NULL AND "binNo" <> '' AND "receivedGrossQtyKgs" ~ '^[0-9.]+$'
UNION ALL
SELECT
  "binNo",
  "date",
  0::numeric,
  "netWeightOfRcnIssuedToSilosKgs"::numeric,
  'issued_to_silos',
  "id"
FROM "CalibrationRun"
WHERE "binNo" IS NOT NULL AND "binNo" <> '' AND "netWeightOfRcnIssuedToSilosKgs" ~ '^[0-9.]+$';

CREATE VIEW "production_bin_stock" AS
SELECT
  m.*,
  SUM(m.qty_in - m.qty_out) OVER (
    PARTITION BY m."binNo" ORDER BY m."date", m.source_id
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_balance
FROM "production_bin_movement" m;

-- ─────────────────────────────────────────────────────────────────────────────
-- Silo stock: "in" is Sized RCN issued to the silos (real, now:true), "out" is Cooked Qty drawn
-- for Cooking (real, now:true) — both stored verbatim on SilosStockRow. The sheet's own
-- Opening/Closing Stock columns are exposed alongside (reportedOpening/reportedClosing) for
-- comparison, never overwritten, mirroring jute's reportedBalance/computed_balance split.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE VIEW "production_silo_stock" AS
SELECT
  s."id",
  s."binNo",
  s."date",
  s."sizedRcnKgs",
  s."cookedQtyKgs",
  s."openingStockKgs"  AS reported_opening,
  s."closingStockKgs"  AS reported_closing,
  SUM(
    COALESCE(NULLIF(s."sizedRcnKgs", '')::numeric, 0)
    - COALESCE(NULLIF(s."cookedQtyKgs", '')::numeric, 0)
  ) OVER (
    PARTITION BY s."binNo" ORDER BY s."date", s."id"
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS computed_balance
FROM "SilosStockRow" s
WHERE s."binNo" IS NOT NULL AND s."binNo" <> '';
