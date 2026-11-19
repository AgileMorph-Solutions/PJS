/**
 * Production's approvals, as one queue per role (Lokesh, 16 Nov 2026, "Option 1": the warehouse enters a load's quantity
 * and quality, "then operations will accept"). Each step goes up to the role above it: a QFS Officer's moisture check to
 * the Warehouse Incharge; the warehouse's weighed load, and a QFS Officer's checks after it, to the Production Incharge.
 * The Approvals page and its sidebar badge read the same queue, so the count is the list.
 */
import { canRecordIntake, canRunProduction, type Role } from "../data/roles.js";

export type ProductionApprovalKind = "load_acceptance" | "moisture_check" | "sizing_check" | "lot_entry";

export const PRODUCTION_APPROVAL_LABELS: Record<ProductionApprovalKind, string> = {
  load_acceptance: "Load to accept",
  moisture_check: "Moisture check",
  sizing_check: "Silo check (QC-2)",
  lot_entry: "Lot check",
};

/** The approvals a role decides: the warehouse's side before the handover, production's from it on. Admin decides both. */
export function productionApprovalKinds(role: Role): ProductionApprovalKind[] {
  return [
    ...(canRecordIntake(role) ? (["moisture_check"] as const) : []),
    ...(canRunProduction(role) ? (["load_acceptance", "sizing_check", "lot_entry"] as const) : []),
  ];
}

/** One thing waiting for a decision. `id` is what the decision's own endpoint takes: a load's ID, or a check's number. */
export interface ProductionApproval {
  kind: ProductionApprovalKind;
  id: string | number;
  /** The production run it belongs to: its system ID, and the name the team gave it, if any. */
  runCode: string;
  runName: string | null;
  /** The load (RR-…) or Lot it is about, to open its page; the warehouse bin a load came from. */
  loadId: string | null;
  binCode: string | null;
  lotCode: string | null;
  /** One line naming it, then one line of its figures, in the words the screens use. */
  title: string;
  detail: string;
  /** Who it is waiting from, and since when (ISO). */
  submittedBy: string | null;
  at: string;
}
