/**
 * A truck's journey as the client reads it: when it arrived and what happened next. Pure and derived
 * from the receipt, so the summary at the top of a receipt can't disagree with its status.
 *
 * The date shown is the business date the warehouse typed when the stage has one (DATE OF ARRIVAL,
 * DATE OF OFFLOADING), because that is what the client's sheets call "when". Every other step has no
 * such field, so it falls back to when the system recorded the status change (the timeline entry) and
 * says so, rather than passing a recording time off as a business date.
 */
import type { ReceiptRecord, ReceiptStatus } from "../types/receipt.js";
import { deriveStatus } from "./receiptStatus.js";

export type TimelineStepState = "done" | "rejected" | "next";

export interface TruckTimelineStep {
  id: "arrived" | "quality" | "unloaded" | "lot" | "grn" | "stock" | "drying" | "transfer";
  label: string;
  state: TimelineStepState;
  /** YYYY-MM-DD (plus HH:mm when the system recorded a time); null when nothing was recorded. */
  at: string | null;
  /** "recorded" = when the system noted the change, not a date the warehouse entered. */
  atKind: "entered" | "recorded" | null;
  detail?: string;
}

/** How far along each status is. `rejected` stops the journey, so it has no place in this ordering. */
const REACHED: Record<ReceiptStatus, number> = {
  planned: 0, arrived: 1, pending_qa: 2, rejected: 2, pending_unload: 3, unloaded: 4, grn_completed: 5, in_stock: 6, in_drying: 7, transferred_out: 8,
};

const GRN_LABEL = "GRN Weight (kept separate from Gross/Net/Paid)";

const day = (v: string | undefined | null) => (v ?? "").trim().slice(0, 10) || null;
/** A bare date stays a date; a full timestamp keeps its time, to the minute. */
const stamp = (v: string) => (v.includes("T") ? `${v.slice(0, 10)} ${v.slice(11, 16)}` : v.slice(0, 10));

export function truckTimeline(r: ReceiptRecord): TruckTimelineStep[] {
  const status = deriveStatus(r);
  const reached = REACHED[status];
  const rejected = status === "rejected";
  const first = (...s: ReceiptStatus[]) => r.timeline.find((t) => s.includes(t.status));
  const recorded = (...s: ReceiptStatus[]) => { const t = first(...s); return t ? { at: stamp(t.at), atKind: "recorded" as const } : { at: null, atKind: null }; };
  const sd = r.stageData;

  const arrivedOn = day(sd["n-gate"]?.["DATE OF ARRIVAL"]) ?? day(r.arrivalDate);
  const offloadedOn = day(sd["n-unload"]?.["DATE OF OFFLOADING"]);
  const lotNote = r.timeline.find((t) => /issued/i.test(t.note ?? ""));
  const grnKg = (sd["n-grn"]?.[GRN_LABEL] ?? "").trim();
  const reason = (sd["n-reject"]?.["Reason for rejection"] ?? "").trim();

  const steps: (TruckTimelineStep & { at_: number })[] = [
    { id: "arrived", label: "Arrived at the gate", at_: 1, state: "done", at: arrivedOn, atKind: arrivedOn ? "entered" : null,
      detail: [r.vehicleNo, r.supplierName].filter(Boolean).join(" · ") || undefined },
    { id: "quality", label: rejected ? "Rejected at quality check" : "Quality check passed", at_: 3, state: rejected ? "rejected" : "done",
      ...recorded("pending_unload", "rejected"), detail: rejected ? reason || "No reason recorded" : undefined },
    { id: "unloaded", label: "Unloaded and weighed", at_: 4, state: "done", at: offloadedOn ?? recorded("unloaded").at, atKind: offloadedOn ? "entered" : recorded("unloaded").atKind },
    { id: "lot", label: "Lot issued", at_: 3, state: "done", ...(lotNote ? { at: stamp(lotNote.at), atKind: "recorded" as const } : { at: null, atKind: null }), detail: r.lotNo },
    { id: "grn", label: "GRN recorded", at_: 5, state: "done", ...recorded("grn_completed"), detail: grnKg ? `${Number(grnKg.replace(/\s/g, "").replace(",", ".")).toLocaleString()} kg` : undefined },
    { id: "stock", label: "In stock", at_: 6, state: "done", ...recorded("in_stock"), detail: r.binNo },
    { id: "drying", label: "Drying", at_: 7, state: "done", ...recorded("in_drying") },
    { id: "transfer", label: "Transferred out", at_: 8, state: "done", ...recorded("transferred_out") },
  ];

  // Everything the truck got through, then the one step it is waiting on. A rejected truck stops at
  // the rejection: the steps after it never happen, and listing them as pending would be wrong.
  const out: TruckTimelineStep[] = [];
  let nextAdded = false;
  for (const { at_, ...step } of steps) {
    if (rejected && step.id !== "arrived" && step.id !== "quality") continue;
    // The rejection itself is the quality step happening, even though a rejected truck never reaches "pending unload".
    if (reached >= at_ || (rejected && step.id === "quality")) { out.push(step); continue; }
    // Drying is a branch, not a stage every truck passes through; only offer it once the truck is in stock.
    if (!nextAdded && step.id !== "drying" && step.id !== "transfer") { out.push({ ...step, state: "next", at: null, atKind: null, detail: undefined }); nextAdded = true; }
  }
  return out;
}
