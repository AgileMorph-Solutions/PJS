import { isUnlistedOrigin } from "@anagroci/contract/domain/origin";

/** Said under every origin picker when the typed town isn't in the master: a warning, not a block — an unplanned truck can come
 * from a town nobody has added yet, and refusing it at the gate would leave the truck unrecorded. */
export const UNLISTED_ORIGIN = "Not in Masters › Origins — it will be saved as typed. Check the spelling, or add the town there.";

/** Stage 2's ORIGIN field: the master to pick from, and the warning while the typed value isn't in it. */
export function originFieldProps(stageId: string, values: Record<string, string>, origins: string[]) {
  if (stageId !== "n-verify") return {};
  return {
    options: { ORIGIN: origins },
    warnings: isUnlistedOrigin(values["ORIGIN"], origins) ? { ORIGIN: UNLISTED_ORIGIN } : undefined,
  };
}
