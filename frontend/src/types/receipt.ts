// The core record this app tracks: one RCN Receipt — a delivery plan through to its truck's
// arrival, Lot/Bin assignment, drying, and onward transfer. The vehicle/truck is one attribute
// of it, present only at the start; the Receipt (via its Lot) is what's tracked for the rest of
// its life, long after the truck itself has left. Field labels inside stageData match
// src/data/stages.ts exactly (that file is the field dictionary), so the same StageForm renders
// both the intake wizard and the receipt detail page.

export type ReceiptStatus =
  | "planned"
  | "arrived"
  | "pending_qa"
  | "rejected"
  | "pending_unload"
  | "unloaded"
  | "grn_completed"
  | "in_stock"
  | "in_drying"
  | "transferred_out";

export interface TimelineEntry {
  status: ReceiptStatus;
  at: string;
  note?: string;
}

export interface ReceiptRecord {
  id: string;
  source: "imported" | "entered";
  arrivalDate: string;
  supplierName: string;
  lbaCode: string;
  vehicleNo: string;
  warehouse: string;
  origin?: string;
  lotNo?: string;
  binNo?: string;
  stageData: Record<string, Record<string, string>>;
  branches: Record<string, string>;
  timeline: TimelineEntry[];
}
