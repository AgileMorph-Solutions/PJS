import type { ReceiptRecord, ReceiptStatus } from "../types/receipt.js";

/**
 * The status inputs. Narrowed to what deriveStatus actually reads, so the backend can derive a
 * status mid-transaction without materialising a whole ReceiptRecord.
 */
export type StatusInputs = Pick<ReceiptRecord, "branches" | "stageData">;

// Status is always derived from the record, never hand-set, so it can't drift from what's
// actually been filled in. Order matters: check terminal branches first, then walk backwards
// through the furthest stage that has data.
//
// NOTE the truthiness check is on the PRESENCE of the stage object, not on it holding any filled
// value: stageData["n-drying"] = {} still yields "in_drying". That is relied upon — the frontend
// writes a stage key as soon as a field is touched. The backend reproduces it via StageEntry.
export function deriveStatus(r: StatusInputs): ReceiptStatus {
  if (r.branches["n-qfs"] === "fail") return "rejected";
  if (r.branches["n-xferdec"] === "transfer") return "transferred_out";
  if (r.stageData["n-drying"]) return "in_drying";
  if (r.stageData["n-stock"]) return "in_stock";
  if (r.stageData["n-grn"]) return "grn_completed";
  if (r.stageData["n-unload"]) return "unloaded";
  if (r.branches["n-qfs"] === "pass") return "pending_unload";
  if (r.stageData["n-verify"]) return "pending_qa";
  if (r.stageData["n-gate"]) return "arrived";
  return "planned";
}

export const STATUS_LABELS: Record<ReceiptStatus, string> = {
  planned: "Planned",
  arrived: "Arrived",
  pending_qa: "Pending QA",
  rejected: "Rejected",
  pending_unload: "Pending unload",
  unloaded: "Unloaded",
  grn_completed: "GRN completed",
  in_stock: "In stock",
  in_drying: "In drying",
  transferred_out: "Transferred out",
};

// Reuses the same shape/color vocabulary as the stage kind chips (entry/decision/system/gap)
// so a status pill and a stage chip read as the same design language.
export const STATUS_TONE: Record<ReceiptStatus, "entry" | "decision" | "system" | "gap" | "term"> = {
  planned: "system",
  arrived: "entry",
  pending_qa: "decision",
  rejected: "gap",
  pending_unload: "decision",
  unloaded: "entry",
  grn_completed: "entry",
  in_stock: "term",
  in_drying: "decision",
  transferred_out: "term",
};

export const ALL_STATUSES: ReceiptStatus[] = [
  "planned", "arrived", "pending_qa", "rejected", "pending_unload",
  "unloaded", "grn_completed", "in_stock", "in_drying", "transferred_out",
];

export interface DashboardCounts {
  totalReceived: number;
  acceptedUnloaded: number;
  grnCompleted: number;
  pendingQa: number;
  pendingUnload: number;
  rejected: number;
}

const UNLOADED_OR_BEYOND: ReceiptStatus[] = ["unloaded", "grn_completed", "in_stock", "in_drying", "transferred_out"];
const GRN_OR_BEYOND: ReceiptStatus[] = ["grn_completed", "in_stock", "in_drying", "transferred_out"];

/** Directly implements doc §3's required dashboard line items. */
export function computeDashboardCounts(receipts: StatusInputs[]): DashboardCounts {
  const statuses = receipts.map(deriveStatus);
  const count = (pred: (s: ReceiptStatus) => boolean) => statuses.filter(pred).length;
  return {
    totalReceived: count((s) => s !== "planned"),
    acceptedUnloaded: count((s) => UNLOADED_OR_BEYOND.includes(s)),
    grnCompleted: count((s) => GRN_OR_BEYOND.includes(s)),
    pendingQa: count((s) => s === "pending_qa"),
    pendingUnload: count((s) => s === "pending_unload"),
    rejected: count((s) => s === "rejected"),
  };
}
