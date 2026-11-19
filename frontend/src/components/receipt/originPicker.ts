import { isUnlistedOrigin } from "@anagroci/contract/domain/origin";

/**
 * Origin is picked from Masters › Origins, never typed (Nov 2026); a new town is added there first, and the server refuses
 * one that isn't (services/masters.ts assertKnownOrigin). Said only beside an older value — an upload's — that the master
 * doesn't have: it stays as it is until someone picks a town from the list.
 */
export const UNLISTED_ORIGIN = "Not in Masters › Origins. Pick a town from the list, or add it in Masters › Origins.";

/** Stage 2's ORIGIN field: a dropdown of the master, and the note while an older value isn't in it. */
export function originFieldProps(stageId: string, values: Record<string, string>, origins: string[]) {
  if (stageId !== "n-verify") return {};
  return {
    choices: { ORIGIN: origins },
    warnings: isUnlistedOrigin(values["ORIGIN"], origins) ? { ORIGIN: UNLISTED_ORIGIN } : undefined,
  };
}
