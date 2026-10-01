/**
 * The columns of the Warehouse Incharge's "several trucks at once" grid: the fields known at the
 * gate, when a truck arrives and its documents are checked. Everything after that (weights, lot,
 * bin, drying, …) still happens on the receipt itself; this only opens receipts in bulk.
 *
 * Labels are the exact `n` strings from stages.ts; contract's test asserts each still exists. S N,
 * WEEK, WH LOCATION and the other gate columns are deliberately not here — a row is the minimum to
 * open a truck, and the rest can be filled on the receipt.
 */
export interface BatchColumn {
  stageId: "n-gate" | "n-verify";
  label: string;
}

export const BATCH_TRUCK_COLUMNS: BatchColumn[] = [
  { stageId: "n-gate", label: "DATE OF ARRIVAL" },
  { stageId: "n-gate", label: "VEHICLE NO." },
  { stageId: "n-gate", label: "CREDIT/CASH" },
  { stageId: "n-gate", label: "REMARKS" },
  { stageId: "n-verify", label: "SUPPLIERS NAME" },
  { stageId: "n-verify", label: "LBA CODE" },
  { stageId: "n-verify", label: "FICHE" },
  { stageId: "n-verify", label: "ORIGIN" },
];

/** A row with no vehicle number isn't a truck yet. */
export const BATCH_REQUIRED_LABEL = "VEHICLE NO.";

/** Keeps one request from opening an unbounded number of receipts in a single transaction. */
export const BATCH_MAX_ROWS = 200;

/** One row as sent to the API: {stageId: {label: value}}. */
export type BatchTruckRow = Record<string, Record<string, string>>;
