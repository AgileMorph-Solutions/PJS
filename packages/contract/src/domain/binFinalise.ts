/**
 * The Bin step's Finalise action (stages.ts n-bin). It stamps the allocation date and who finalised it; nobody types
 * those. "Finalised (same day / next day)" is the person's own answer, picked from a dropdown before finalising (team
 * decision, Nov 2026: chosen by the user, not worked out by the system). The client's process notes name the two
 * answers: a Bin is finalised the same day the Lot is assigned, or the next day if operations require it.
 */
/** The Bin step's fields the Finalise action stamps: nobody types them, and Reopen clears them together. */
export const BIN_FINALISE_FIELDS = ["Bin allocation date", "Finalised by"] as const;

export const FINALISED_WHEN_LABEL = "Finalised (same day / next day)";
export const FINALISED_SAME_DAY = "Same day";
export const FINALISED_NEXT_DAY = "Next day";
