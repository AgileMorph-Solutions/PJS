/**
 * Other warehouse activities (client review, Oct 2026: "improve the classification of other warehouse activities").
 *
 * The real ledger writes the activity type free-hand: 787 rows and 12 spellings, among them "Staking" (stacking),
 * "Destaking", "Recondition", "DRYING" / "Drying" / "Dying", "RAMASSAGE" (gathering up spilled nuts) and bin jobs. This
 * list is the classification: a fixed set of categories for activities recorded in the app, and `classifyActivity` which reads
 * the category of any text (an imported row's, or an old spelling) so the two can be filtered together WITHOUT rewriting what
 * the workbook said.
 *
 * Per the Sept 2026 clarification, triage / cleaning is not drying: quality, moisture and quantity can all change, so it must
 * record its own checks. Every other activity stays linked to its Lot and location (doc §5.4).
 */
export type ActivityCategoryId =
  | "offloading" | "stacking" | "destacking" | "reconditioning" | "drying" | "triage" | "bin_work" | "movement" | "other";

export interface ActivityCategory {
  id: ActivityCategoryId;
  label: string;
  /** The activity concerns a Lot's stock, so it names the Lot. */
  needsLot: boolean;
  /** Moisture and the quantity before and after are recorded (triage / cleaning). */
  needsQuality: boolean;
  /** Recorded on its own form on the truck, not here. */
  useDryingForm?: boolean;
  /** Two places: a "from" and a "to". */
  needsTwoLocations?: boolean;
  /** Matches an activity text written by hand. Tried in this order, first match wins. */
  match: RegExp;
}

export const ACTIVITY_CATEGORIES: readonly ActivityCategory[] = [
  // Bin jobs first: "BIN RECONDITION" is work on the bin, not on a Lot's bags.
  { id: "bin_work", label: "Bin rearranging / repair", needsLot: false, needsQuality: false, match: /^\s*bin\b/i },
  { id: "destacking", label: "Destacking", needsLot: true, needsQuality: false, match: /de-?\s*st(?:a|ac)?king|destak|destack/i },
  { id: "stacking", label: "Stacking", needsLot: true, needsQuality: false, match: /st(?:a|ac)?king|stack/i },
  { id: "offloading", label: "Offloading", needsLot: true, needsQuality: false, match: /off-?load|unload|discharg|décharg|decharg/i },
  { id: "reconditioning", label: "Re-bagging / reconditioning", needsLot: true, needsQuality: false, match: /recondition|re-?bag|stit?ch|repair|mend/i },
  { id: "drying", label: "Drying", needsLot: true, needsQuality: false, useDryingForm: true, match: /dry|dying|s[eè]ch|sech/i },
  { id: "triage", label: "Triage / cleaning", needsLot: true, needsQuality: true, match: /triage|clean|sort|nettoy|ramass/i },
  { id: "movement", label: "Movement between locations", needsLot: true, needsQuality: false, needsTwoLocations: true, match: /\bmov|shift|relocat|d[eé]plac|transfer/i },
  { id: "other", label: "Other", needsLot: false, needsQuality: false, match: /$^/ },
];

const BY_ID = new Map(ACTIVITY_CATEGORIES.map((c) => [c.id, c]));
export const categoryById = (id: ActivityCategoryId): ActivityCategory => BY_ID.get(id)!;
export const ACTIVITY_LABEL: Record<ActivityCategoryId, string> = Object.fromEntries(ACTIVITY_CATEGORIES.map((c) => [c.id, c.label])) as Record<ActivityCategoryId, string>;

/** The category of any activity text. Blank or unrecognised is "Other": it is shown as such, never guessed into a real category. */
export function classifyActivity(text: string | null | undefined): ActivityCategoryId {
  const t = (text ?? "").trim();
  if (!t) return "other";
  return ACTIVITY_CATEGORIES.find((c) => c.id !== "other" && c.match.test(t))?.id ?? "other";
}

/** The activity types the app records are the category labels themselves, so a recorded one classifies to its own category. */
export interface ActivityEntryInput {
  category?: string;
  date?: string;
  lotNo?: string;
  locationFrom?: string;
  locationTo?: string;
  bags?: string | number | null;
  moisturePct?: string | number | null;
  quantityBeforeKg?: string | number | null;
  quantityAfterKg?: string | number | null;
  remarks?: string;
}

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
const asNumber = (v: unknown) => (blank(v) ? null : Number(String(v).replace(/\s/g, "").replace(",", ".")));

/** What is wrong with an activity entry, in plain words, or an empty list. One place, for the form and for the server. */
export function activityProblems(input: ActivityEntryInput): string[] {
  const cat = ACTIVITY_CATEGORIES.find((c) => c.id === input.category);
  if (!cat) return ["Choose the kind of activity."];
  const out: string[] = [];
  if (cat.useDryingForm) out.push("Drying is recorded on the truck itself (Does this Lot need drying? Yes), so its moisture and weights are captured there.");
  if (cat.needsLot && blank(input.lotNo)) out.push(`${cat.label} is recorded against a Lot: choose which one.`);
  if (blank(input.locationFrom)) out.push(cat.needsTwoLocations ? "Say where it moved from." : "Say where in the warehouse it was done (store or bin).");
  if (cat.needsTwoLocations && blank(input.locationTo)) out.push("Say where it moved to.");
  if (cat.id === "other" && blank(input.remarks)) out.push("Describe the activity in the remarks: it doesn't fit a listed kind.");
  const bags = asNumber(input.bags);
  if (bags !== null && (!Number.isInteger(bags) || bags < 0)) out.push("Bags must be a whole number.");
  if (cat.needsQuality) {
    const m = asNumber(input.moisturePct);
    const before = asNumber(input.quantityBeforeKg);
    const after = asNumber(input.quantityAfterKg);
    if (m === null || Number.isNaN(m) || m < 0 || m > 100) out.push("Triage changes the moisture: record it, between 0 and 100.");
    if (before === null || Number.isNaN(before) || before < 0) out.push("Triage changes the quantity: record the kg before.");
    if (after === null || Number.isNaN(after) || after < 0) out.push("Triage changes the quantity: record the kg after.");
    if (before !== null && after !== null && !Number.isNaN(before) && !Number.isNaN(after) && after > before) out.push("The quantity after triage can't be more than before.");
  }
  return out;
}
