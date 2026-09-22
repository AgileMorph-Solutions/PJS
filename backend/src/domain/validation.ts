// Server-side enforcement of the Sept 2026 clarification's binding rules. The frontend only ever
// showed these as notes — it never blocked a bad write, and localStorage never could.
//
// Note the split: these are HARD rules that reject a write (422). Data-quality findings are a
// different thing entirely — they are warnings attached to a successful write, because the real
// client data violates them and blocking would make it unimportable. See domain/dataQuality/.

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
export function assertLotBeforeBin(currentLotNo: string | null | undefined, incomingBinNo: string | null | undefined): void {
  if (incomingBinNo && incomingBinNo.trim() && !(currentLotNo && currentLotNo.trim())) {
    throw new ValidationError(
      "Cannot allocate a Bin before this receipt has a Lot Number — the Lot Number is assigned first, at truck-unload approval."
    );
  }
}

/**
 * Confirmed rule: "a rejected truck must stay visible in the system — Status = Rejected, with a
 * reason — not disappear." Enforced at the moment n-qfs is set to fail, rather than trusting a
 * later optional write to the reject stage.
 *
 * NOTE: the 50 seeded receipts include 6 that are already rejected with no reason recorded. The
 * seeder therefore goes through the service layer with bypassValidation, and those 6 are reported
 * as a `rejected_without_reason` finding rather than being silently given an invented reason.
 */
export function assertRejectionHasReason(branchId: string, reason: string | null | undefined): void {
  if (branchId === "fail" && (!reason || !reason.trim())) {
    throw new ValidationError('A rejected truck requires "Reason for rejection" — the record must persist with a reason, not vanish.');
  }
}

/**
 * Confirmed rule: drying is always issued and tracked at the specific Lot/quantity level, never at
 * the whole-Bin level — one Bin can mix several Lots, so "dry this Bin" is not a valid operation.
 */
export function assertDryingJobHasLot(job: { lotNo?: string | null; bin?: string | null }): void {
  if (!job.lotNo || !job.lotNo.trim()) {
    throw new ValidationError(
      "A drying job must identify the specific Lot/quantity being dried — never issue drying against a whole Bin, since one Bin can hold multiple Lots."
    );
  }
}
