import { describe, it, expect } from "vitest";
import { dryingLoss, dryingReturnProblem } from "../src/domain/dryingLoss";
import { DECISION_BRANCHES } from "../src/domain/decisions";
import { deriveStatus } from "../src/domain/receiptStatus";
import type { ReceiptRecord } from "../src/types/receipt";

describe("drying loss", () => {
  it("is the weight lost, its share of what was issued, and the moisture points removed", () => {
    expect(dryingLoss(10000, 9300, 11.8, 8.6)).toEqual({ lossKg: 700, lossPct: 7, moistureLossPct: 3.2 });
  });
  it("leaves a figure empty when its inputs are missing, rather than showing 0", () => {
    expect(dryingLoss(0, 0, null, 8)).toEqual({ lossKg: 0, lossPct: null, moistureLossPct: null });
  });
  it("refuses a dried quantity above what was issued, or one that isn't a number", () => {
    expect(dryingReturnProblem(1000, 1000)).toBeNull();
    expect(dryingReturnProblem(1000, 1200)).toMatch(/can't be more than/);
    expect(dryingReturnProblem(1000, Number.NaN)).toMatch(/number of kg/);
  });
});

describe("the drying decision", () => {
  const base = (over: Partial<ReceiptRecord>): ReceiptRecord => ({
    id: "R", source: "entered", arrivalDate: "2026-09-01", supplierName: "", lbaCode: "", vehicleNo: "", warehouse: "BOUAKE",
    stageData: { "n-gate": {}, "n-verify": {}, "n-unload": {}, "n-grn": { PRICE: "1", "GRN Weight (kept separate from Gross/Net/Paid)": "1" }, "n-stock": {} },
    branches: { "n-qfs": "pass" }, timeline: [], ...over,
  });

  it("offers No (no drying needed) beside the two ways of drying", () => {
    expect(DECISION_BRANCHES["n-drying"]!.map((b) => b.id)).toEqual(["direct", "indirect", "none"]);
  });

  it("answering No leaves the truck's status exactly where it was: only a drying step that exists makes a truck 'in drying'", () => {
    const before = deriveStatus(base({}));
    expect(deriveStatus(base({ branches: { "n-qfs": "pass", "n-drying": "none" } }))).toBe(before);
    expect(deriveStatus(base({ stageData: { ...base({}).stageData, "n-drying": {} }, branches: { "n-qfs": "pass", "n-drying": "direct" } }))).toBe("in_drying");
  });
});
