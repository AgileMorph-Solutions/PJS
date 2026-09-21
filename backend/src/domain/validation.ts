// Server-side enforcement of the Sept 2026 clarification's binding rules (see
// backend/BACKEND_BUILD_PROMPT.md §2). The frontend only ever showed these as notes/labels — it
// never blocked a bad write. This is the layer that actually enforces them, since localStorage
// never could.
import type { ReceiptRecord } from "../types.js";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Confirmed rule: "after the Lot Number is assigned, the Warehouse Team decides the Bin Number."
 * A Bin can never be allocated before its Lot exists.
 */
export function assertLotBeforeBin(receipt: Pick<ReceiptRecord, "lotNo">, incomingBinNo: string | null | undefined): void {
  if (incomingBinNo && !receipt.lotNo) {
    throw new ValidationError(
      "Cannot allocate a Bin before this receipt has a Lot Number — the Lot Number is assigned first, at truck-unload approval."
    );
  }
}

/**
 * Confirmed rule: "a rejected truck must stay visible in the system — Status = Rejected, with a
 * reason — not disappear." Enforced by requiring a reason at the moment n-qfs is set to fail,
 * rather than trusting a later, optional write to the reject stage.
 */
export function assertRejectionHasReason(branchId: string, reason: string | null | undefined): void {
  if (branchId === "fail" && (!reason || !reason.trim())) {
    throw new ValidationError('A rejected truck requires "Reason for rejection" — the record must persist with a reason, not vanish.');
  }
}

/**
 * Confirmed rule: "Even when the RCN is stored in a Bin, the specific Lot/truck and quantity
 * being issued for drying must be identified and recorded. We should not treat the entire Bin as
 * one single drying batch." A drying job must reference a real Lot, never be created against a
 * Bin alone.
 */
export function assertDryingJobHasLot(job: { lotNo?: string | null; bin?: string | null }): void {
  if (!job.lotNo || !job.lotNo.trim()) {
    throw new ValidationError(
      "A drying job must identify the specific Lot/quantity being dried — never issue drying against a whole Bin, since one Bin can hold multiple Lots."
    );
  }
}
