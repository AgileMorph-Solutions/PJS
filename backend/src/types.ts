// Mirrors frontend/src/types/receipt.ts and frontend/src/types/stage.ts exactly — this backend
// is a faithful server-side implementation of that model, not a redesign. Keep in sync by hand.

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
  note?: string | null;
}

export interface ReceiptRecord {
  id: string;
  source: "imported" | "entered";
  arrivalDate: string;
  supplierName: string;
  lbaCode: string;
  vehicleNo: string;
  warehouse: string;
  origin?: string | null;
  lotNo?: string | null;
  binNo?: string | null;
  stageData: Record<string, Record<string, string>>;
  branches: Record<string, string>;
  timeline: TimelineEntry[];
}

export type LedgerRow = Record<string, string>;

export const JUTE_LEDGER_IDS = [
  "warehouse-stock",
  "supplier-movement",
  "factory-production-tracking",
  "warehouse-to-warehouse-movement",
] as const;
export type JuteLedgerId = (typeof JUTE_LEDGER_IDS)[number];
