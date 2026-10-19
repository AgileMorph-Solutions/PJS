/**
 * The two parts of receiving a truck (client review, Oct 2026). They are NOT separate screens: the team asked for them
 * as separate modules, then settled on one Reception page where "Offloading" is a status filter. One list of which
 * stages belong to which, read by that filter (MODULE_STATUSES) and by the record lock (what stops being editable once
 * the GRN is complete), so they cannot disagree.
 *
 *   Reception  : the truck arrives, its papers are checked, it is weighed and quality-tested, and accepted or rejected.
 *   Offloading : it is unloaded, the weights give the net weight, and it gets a Lot, a Bin and its GRN.
 *
 * Stage ids are the ones in stages.ts. `n-stock` is the system's own stock update that follows the GRN.
 */
import type { ReceiptStatus } from "../types/receipt.js";

export type ReceivingModule = "reception" | "offloading";

export const RECEPTION_STAGES = ["n-gate", "n-verify", "n-gross", "n-qfs", "n-reject"] as const;
export const OFFLOADING_STAGES = ["n-unload", "n-tare", "n-netwt", "n-lot", "n-bin", "n-grn", "n-stock"] as const;

export const MODULE_STAGES: Record<ReceivingModule, readonly string[]> = {
  reception: RECEPTION_STAGES,
  offloading: OFFLOADING_STAGES,
};

export const MODULE_LABELS: Record<ReceivingModule, string> = { reception: "Reception", offloading: "Offloading" };

export function moduleOfStage(stageId: string): ReceivingModule | null {
  return (RECEPTION_STAGES as readonly string[]).includes(stageId) ? "reception"
    : (OFFLOADING_STAGES as readonly string[]).includes(stageId) ? "offloading" : null;
}

/**
 * The trucks each part's filter on the Reception page shows: a truck is in Reception until it has been accepted, and in Offloading from the
 * moment it passes quality. A rejected truck stays in Reception: rejection is how reception ends for it.
 */
export const MODULE_STATUSES: Record<ReceivingModule, readonly ReceiptStatus[]> = {
  reception: ["planned", "arrived", "pending_qa", "rejected"],
  offloading: ["pending_unload", "unloaded", "grn_completed", "in_stock", "in_drying", "transferred_out"],
};
