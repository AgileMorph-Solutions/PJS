/**
 * docs/Procurement Auto Populate Fields.xlsx (client, Nov 2026): which procurement fields fill themselves, which are only
 * suggested, and which are picked from a list. One case per row of the sheet, so a row that stops working is named.
 */
import { describe, it, expect } from "vitest";
import { AUTO_FIELDS, autoFill, isAutoField } from "../src/data/autoFields";
import { BIN_FINALISE_FIELDS, FINALISED_WHEN_LABEL } from "../src/domain/binFinalise";
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

// The sheet's row 3 made the tally a suggestion of good + torn; the team changed it (Nov 2026): it is calculated, good bags
// + the torn bags reconditioned (receiptMath.ts), so nothing is suggested for it any more.
describe("row 3: Tally Clerk bag count, calculated now — not a suggestion", () => {
  it("offers no suggestion for the tally", () => {
    const unload = { "n-unload": { "BON SACS (good bags)": "463", "Sacs déchirés (torn bags)": "15" } };
    expect(prefillSuggestions(unload, "n-unload")["Tally Clerk bag count"]).toBeUndefined();
  });
});

// The sheet's row 4 had the system work this out from the Lot and allocation dates; the team changed it (Nov 2026): the
// person picks it from a dropdown before finalising.
describe("row 4: Finalised (same day / next day), picked by the person", () => {
  it("is a dropdown of the two answers, not something Finalise stamps", () => {
    expect(fieldChoices("n-bin", FINALISED_WHEN_LABEL)).toEqual(["Same day", "Next day"]);
    expect(BIN_FINALISE_FIELDS).not.toContain(FINALISED_WHEN_LABEL);
    expect(isAutoField("n-bin", FINALISED_WHEN_LABEL)).toBe(false);
  });

  it("Finalise stamps the allocation date and who, all of them in the spec", () => {
    expect([...BIN_FINALISE_FIELDS]).toEqual(["Bin allocation date", "Finalised by"]);
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
