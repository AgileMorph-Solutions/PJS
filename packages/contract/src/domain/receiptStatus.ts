import type { ReceiptRecord, ReceiptStatus } from "../types/receipt.js";
import type { Stage } from "../types/stage.js";
import { stages } from "../data/stages.js";

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

export interface StageProgress {
  /** Stage ids counted as "reached" — decision stages by having a chosen branch, everything else
   * by key PRESENCE in stageData. Mirrors deriveStatus's presence-not-content rule exactly, so this
   * is the only other place that rule is allowed to live. */
  doneIds: Set<string>;
  doneCount: number;
  totalCount: number;
  /** The stage right after the FURTHEST one reached — not the first gap scanning from the start.
   * n-lot ("Assign Lot Number") is a real gap that the client's own OFFLOADINGS sheet never
   * captured, so it's blank on nearly every imported receipt — a naive first-undone scan would
   * anchor "current progress" on it even for a receipt already through drying, which is exactly
   * backwards. Undefined once every stage in stageList is done. */
  activeStage?: Stage;
}

export function getStageProgress(r: StatusInputs, stageList: Stage[] = stages): StageProgress {
  const completedIds = new Set(Object.keys(r.stageData));
  const isDone = (s: Stage) => (s.kind === "decision" ? r.branches[s.id] !== undefined : completedIds.has(s.id));
  const doneIds = new Set(stageList.filter(isDone).map((s) => s.id));
  const lastDoneIndex = stageList.reduce((max, s, i) => (isDone(s) ? i : max), -1);
  return {
    doneIds,
    doneCount: doneIds.size,
    totalCount: stageList.length,
    activeStage: stageList[lastDoneIndex + 1],
  };
}

/** True when a stage has been reached (its key exists in stageData) but every field in it is still
 * blank/whitespace — the same ambiguity the backend's `stage_present_but_empty` data-quality check
 * flags server-side (backend/src/domain/dataQuality/checks.ts), computed here instantly from data
 * the client already has, no round trip needed. */
export function isStageBlank(values: Record<string, string> | undefined): boolean {
  if (!values) return false; // not reached at all — a different state, not this one
  return Object.values(values).every((v) => !v || !v.trim());
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
