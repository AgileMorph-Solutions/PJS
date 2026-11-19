/**
 * "Finalised (same day / next day)" on the Bin step (stages.ts n-bin). The client's process notes: a Bin can be finalised
 * the same day the Lot is assigned, or the next day if operations require it. docs/Procurement Auto Populate Fields.xlsx
 * row 4: worked out by comparing the Lot's date (n-lot "Date/time assigned") with the Bin allocation date, both stamped
 * by the system, so nobody types it.
 */
/** The Bin step's fields the Finalise action stamps: nobody types them, and Reopen clears them together. */
export const BIN_FINALISE_FIELDS = ["Bin allocation date", "Finalised by", "Finalised (same day / next day)"] as const;

export const FINALISED_SAME_DAY = "Same day";
export const FINALISED_NEXT_DAY = "Next day";

const dayOf = (iso: string): number | undefined => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 : undefined;
};

/**
 * "Same day", "Next day", or "N days later" when it took longer — the sheet only names the first two, but a later
 * finalisation is real and says how late it was rather than being forced into "next day". Undefined when either date is
 * missing or unreadable (an imported Lot with no assigned time), or the allocation is dated before the Lot.
 */
export function finalisedWhen(lotAssignedAt: string | undefined, allocationDate: string | undefined): string | undefined {
  const lot = dayOf(lotAssignedAt ?? "");
  const bin = dayOf(allocationDate ?? "");
  if (lot === undefined || bin === undefined || bin < lot) return undefined;
  const days = bin - lot;
  return days === 0 ? FINALISED_SAME_DAY : days === 1 ? FINALISED_NEXT_DAY : `${days} days later`;
}
