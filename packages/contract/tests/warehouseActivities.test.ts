import { describe, it, expect } from "vitest";
import { ACTIVITY_CATEGORIES, activityProblems, classifyActivity } from "../src/data/warehouseActivities";

describe("classifying the real ledger's activity types", () => {
  // Every distinct spelling in the client's own 787-row "Warehouse activity Ledger" sheet.
  const REAL: [string, string][] = [
    ["Staking", "stacking"], ["Offloading", "offloading"], ["Recondition", "reconditioning"], ["Destaking", "destacking"],
    ["DRYING", "drying"], ["Drying", "drying"], ["Dying", "drying"], // "Dying" is a typo for Drying
    ["BIN RECONDITION", "bin_work"], ["RAMASSAGE", "triage"], ["Stiching -Jute Bag", "reconditioning"],
    ["BIN CASSE", "bin_work"], ["BIN fallen arrenged", "bin_work"],
  ];
  it.each(REAL)("%s is %s", (text, expected) => expect(classifyActivity(text)).toBe(expected));

  it("keeps Destaking out of Stacking, though the word contains it", () => {
    expect(classifyActivity("destacking")).toBe("destacking");
    expect(classifyActivity("Stacking")).toBe("stacking");
  });
  it("calls blank or unrecognised text Other, never guessing a category", () => {
    for (const t of [null, undefined, "", "   ", "Meeting with the buyer"]) expect(classifyActivity(t)).toBe("other");
  });
  it("the categories the app records classify to themselves, so recorded and imported rows filter together", () => {
    for (const c of ACTIVITY_CATEGORIES) expect(classifyActivity(c.label), c.label).toBe(c.id);
  });
});

describe("what an activity entry needs", () => {
  const base = { date: "2026-10-16", lotNo: "LOT-BKE-2026-0001", locationFrom: "BKE-001" };
  it("needs a kind, a Lot and a place, and says which is missing", () => {
    expect(activityProblems({})).toEqual(["Choose the kind of activity."]);
    expect(activityProblems({ category: "stacking" })).toEqual(["Stacking is recorded against a Lot: choose which one.", "Say where in the warehouse it was done (store or bin)."]);
    expect(activityProblems({ category: "stacking", ...base })).toEqual([]);
  });
  it("a movement needs both ends", () => {
    expect(activityProblems({ category: "movement", ...base })).toEqual(["Say where it moved to."]);
    expect(activityProblems({ category: "movement", ...base, locationTo: "BKE-002" })).toEqual([]);
  });
  it("triage records its own moisture and quantity before and after, and can't gain weight", () => {
    expect(activityProblems({ category: "triage", ...base }).length).toBe(3);
    expect(activityProblems({ category: "triage", ...base, moisturePct: 9.5, quantityBeforeKg: 1000, quantityAfterKg: 940 })).toEqual([]);
    expect(activityProblems({ category: "triage", ...base, moisturePct: 9.5, quantityBeforeKg: 1000, quantityAfterKg: 1100 })).toEqual(["The quantity after triage can't be more than before."]);
    expect(activityProblems({ category: "triage", ...base, moisturePct: 140, quantityBeforeKg: 1, quantityAfterKg: 1 })[0]).toMatch(/between 0 and 100/);
  });
  it("drying points to the truck's drying form, and 'other' must be described", () => {
    expect(activityProblems({ category: "drying", ...base })[0]).toMatch(/recorded on the truck itself/);
    expect(activityProblems({ category: "other", locationFrom: "BKE-001" })).toEqual(["Describe the activity in the remarks: it doesn't fit a listed kind."]);
    expect(activityProblems({ category: "other", locationFrom: "BKE-001", remarks: "Pest check" })).toEqual([]);
  });
});
