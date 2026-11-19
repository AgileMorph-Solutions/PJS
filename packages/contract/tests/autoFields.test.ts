/**
 * docs/Procurement Auto Populate Fields.xlsx (client, Nov 2026): which procurement fields fill themselves, which are only
 * suggested, and which are picked from a list. One case per row of the sheet, so a row that stops working is named.
 */
import { describe, it, expect } from "vitest";
import { AUTO_FIELDS, autoFill, isAutoField } from "../src/data/autoFields";
import { finalisedWhen, BIN_FINALISE_FIELDS } from "../src/domain/binFinalise";
import { prefillSuggestions } from "../src/domain/receiptMath";
import { fieldChoices } from "../src/data/fieldChoices";
import { STAGE_FIELD_MAP } from "../src/generated/stageFieldMap";

const ctx = { today: "2026-11-16", arrivalDate: "2026-11-14", site: "BOUAKE", lot: "LOT-BKE-2026-001", bin: "BKE-002-BIN-003", actorName: "Awa" };

describe("auto-fill (sheet rows 1, 2, 5-8)", () => {
  it("names only fields that exist in the spec", () => {
    for (const [stageId, fields] of Object.entries(AUTO_FIELDS)) {
      for (const f of fields) expect(STAGE_FIELD_MAP[stageId]?.fields.some((x) => x.label === f.label), `${stageId} / ${f.label}`).toBe(true);
    }
  });

  it("row 1: Arrival takes the warehouse from the selected site; its type is not filled here (it follows WH LOCATION, server side)", () => {
    expect(autoFill("n-gate", { "VEHICLE NO.": "1KT" }, undefined, ctx)).toEqual({ "DATE OF ARRIVAL": "2026-11-14", "WH LOCATION": "BOUAKE", WEEK: "W-46 Nov" });
    expect(isAutoField("n-gate", "Warehouse type (Village/Regional/Factory)")).toBe(false);
  });

  it("rows 5-8: the Activity ledger takes the receipt's Lot and Bin, its warehouse, today and who is entering it", () => {
    expect(autoFill("n-ledger", { Quantity: "120" }, undefined, ctx)).toEqual({
      "Date/time": "2026-11-16", Location: "BOUAKE", "Linked Lot/Bin": "LOT-BKE-2026-001 / BKE-002-BIN-003", "Performed by": "Awa",
    });
  });

  it("leaves a field blank rather than guess, when the records don't hold its value", () => {
    // No Bin yet, nobody signed in (an import).
    const out = autoFill("n-ledger", {}, undefined, { today: "2026-11-16", arrivalDate: "", site: "BOUAKE", lot: "LOT-BKE-2026-001" });
    expect(out).toEqual({ "Date/time": "2026-11-16", Location: "BOUAKE", "Linked Lot/Bin": "LOT-BKE-2026-001" });
  });

  it("never overrides what the person typed, what is stored, or a deliberate clear", () => {
    expect(autoFill("n-gate", { "WH LOCATION": "YAKRO FACTORY" }, undefined, ctx)).not.toHaveProperty("WH LOCATION");
    expect(autoFill("n-ledger", {}, { "Performed by": "Kouassi" }, ctx)).not.toHaveProperty("Performed by");
    expect(autoFill("n-ledger", { Location: "" }, undefined, ctx)).not.toHaveProperty("Location");
    expect(isAutoField("n-ledger", "Quantity")).toBe(false);
  });
});

describe("row 3: Tally Clerk bag count is a suggestion, good + torn bags", () => {
  const unload = (v: Record<string, string>) => ({ "n-unload": v });

  it("offers 463 + 15 = 478 while the count is blank", () => {
    expect(prefillSuggestions(unload({ "BON SACS (good bags)": "463", "Sacs déchirés (torn bags)": "15" }), "n-unload")).toEqual({
      "Tally Clerk bag count": { value: "478", from: "good + torn bags" },
    });
  });

  it("offers nothing until both are recorded (0 torn counts), or once the clerk has entered a count", () => {
    expect(prefillSuggestions(unload({ "BON SACS (good bags)": "463" }), "n-unload")).toEqual({});
    expect(prefillSuggestions(unload({ "BON SACS (good bags)": "463", "Sacs déchirés (torn bags)": "0" }), "n-unload")).toEqual({
      "Tally Clerk bag count": { value: "463", from: "good + torn bags" },
    });
    expect(prefillSuggestions(unload({ "BON SACS (good bags)": "463", "Sacs déchirés (torn bags)": "15", "Tally Clerk bag count": "470" }), "n-unload")).toEqual({});
  });

  it("still suggests the GRN weight from the net weight", () => {
    expect(prefillSuggestions({ "n-netwt": { "NET WT KGS": "40822" } }, "n-grn")).toEqual({ "GRN Weight (kept separate from Gross/Net/Paid)": { value: "40822", from: "net weight" } });
  });
});

describe("row 4: Finalised (same day / next day), from the Lot date and the Bin allocation date", () => {
  it("is the sheet's example: Lot 16/02/2026, Bin 17/02/2026 = Next day", () => {
    expect(finalisedWhen("2026-02-16T09:30:00.000Z", "2026-02-17")).toBe("Next day");
    expect(finalisedWhen("2026-02-16T09:30:00.000Z", "2026-02-16")).toBe("Same day");
  });

  it("says how late a later one was, and nothing when a date is missing or the order is impossible", () => {
    expect(finalisedWhen("2026-02-16", "2026-02-19")).toBe("3 days later");
    expect(finalisedWhen(undefined, "2026-02-19")).toBeUndefined();
    expect(finalisedWhen("2026-02-16", "2026-02-15")).toBeUndefined();
  });

  it("is one of the fields Finalise stamps, all of them in the spec", () => {
    for (const label of BIN_FINALISE_FIELDS) expect(STAGE_FIELD_MAP["n-bin"]!.fields.some((f) => f.label === label), label).toBe(true);
  });
});

describe("dropdowns instead of text", () => {
  it("offer the ledger label's own seven activities, and the warehouse type the master's three kinds", () => {
    expect(fieldChoices("n-gate", "Warehouse type (Village/Regional/Factory)")).toEqual(["Village", "Regional Central", "Factory"]);
    expect(fieldChoices("n-ledger", "Activity type (discharge, weight, reconditioning, destacking, drying, triage, sèches)")).toHaveLength(7);
    expect(fieldChoices("n-gate", "VEHICLE NO.")).toBeUndefined();
  });
});
