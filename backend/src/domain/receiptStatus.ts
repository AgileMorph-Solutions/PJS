// Ported from frontend/src/domain/receiptStatus.ts. This is the ONE place receipt status is
// computed, on both sides — the frontend comment's rule holds here too: "Status is always
// derived from the record, never hand-set, so it can't drift from what's actually been filled
// in." Do not add a stored `status` column that can go stale; always recompute from stageData +
// branches at read time.
import type { ReceiptRecord, ReceiptStatus } from "../types.js";

export function deriveStatus(r: Pick<ReceiptRecord, "branches" | "stageData">): ReceiptStatus {
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

const UNLOADED_OR_BEYOND: ReceiptStatus[] = ["unloaded", "grn_completed", "in_stock", "in_drying", "transferred_out"];
const GRN_OR_BEYOND: ReceiptStatus[] = ["grn_completed", "in_stock", "in_drying", "transferred_out"];

export interface DashboardCounts {
  totalReceived: number;
  acceptedUnloaded: number;
  grnCompleted: number;
  pendingQa: number;
  pendingUnload: number;
  rejected: number;
}

/** Directly implements doc §3's required dashboard line items. */
export function computeDashboardCounts(receipts: Pick<ReceiptRecord, "branches" | "stageData">[]): DashboardCounts {
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
