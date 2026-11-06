/**
 * The jute bags a warehouse already holds when it starts counting (client trial observations, 02-11-2026, point 7: "Need
 * Opening Balance Tab to continue further steps", where their "tab" means a field). No workbook has this figure: "Jute Bags
 * movement" opens straight on a purchase, which is part of why its running balance goes negative. The value is the client's
 * to enter, and never estimated.
 */
import { isRealDate, parseBags } from "./juteVendorReceipt.js";

/** The ledger row's activity type. jute_movement_stream reads this exact text as the OPENING movement. */
export const JUTE_OPENING_ACTIVITY = "OPENING BALANCE";

export interface OpeningBalanceInput {
  date?: string;
  bags?: string | number | null;
  remarks?: string;
}

/** What is wrong with an entry, in plain words, or an empty list. A warehouse can genuinely start with no bags, so 0 is allowed. */
export function openingBalanceProblems(input: OpeningBalanceInput): string[] {
  const out: string[] = [];
  if (parseBags(input.bags) === null) out.push("Opening stock must be a whole number of bags.");
  if (!isRealDate(input.date?.trim() ?? "")) out.push("Enter the date this count was taken.");
  return out;
}
