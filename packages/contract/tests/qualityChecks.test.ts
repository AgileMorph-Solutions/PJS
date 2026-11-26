/**
 * The QFS Officer's quality checks (26 Nov 2026): every section is named once, sits at the warehouses it really happens at,
 * and the checks sent from the Quality checks page are refused here for what the server would refuse.
 */
import { describe, it, expect } from "vitest";
import {
  QUALITY_SECTIONS, QUALITY_SECTION_ORDER, QUALITY_SUBMISSION_INFO, QUALITY_SUBMISSION_KINDS, formSubmissionSection,
  qualitySubmissionProblem, sectionsAt, sortQualityItems, type QualityCheckItem,
} from "../src/domain/qualityChecks";
import { lotWeighingProblems, transferLotStatus } from "../src/domain/transferLot";
import { activityProblems } from "../src/data/warehouseActivities";

describe("the quality sections", () => {
  it("lists every section once, in the order RCN goes through them", () => {
    expect([...QUALITY_SECTION_ORDER].sort()).toEqual(Object.keys(QUALITY_SECTIONS).sort());
    expect(new Set(QUALITY_SECTION_ORDER).size).toBe(QUALITY_SECTION_ORDER.length);
  });

  it("gives a Unit warehouse its own checks and the factory's to the Central one", () => {
    expect(sectionsAt("UNIT")).toEqual(["reception", "unloading", "drying", "triage", "transfer_lot"]);
    expect(sectionsAt("CENTRAL")).toEqual(["reception", "unloading", "unit_reception", "drying", "triage", "production_intake", "production"]);
    expect(sectionsAt(null)).toEqual([]);
  });

  it("sends production's checks to the Production Incharge and every other to the Warehouse Incharge", () => {
    for (const s of QUALITY_SECTION_ORDER) expect(QUALITY_SECTIONS[s].approver).toBe(s === "production" ? "production_incharge" : "warehouse_incharge");
  });

  it("puts every check sent from the Quality checks page in a warehouse section", () => {
    for (const k of QUALITY_SUBMISSION_KINDS) expect(QUALITY_SECTIONS[QUALITY_SUBMISSION_INFO[k].section].approver).toBe("warehouse_incharge");
  });

  it("names a reception form by what it fills: the truck's quality, the bag check alone, or a lot from the Unit warehouse", () => {
    expect(formSubmissionSection(["n-qfs"], false)).toBe("reception");
    expect(formSubmissionSection(["n-qfs", "n-unload"], false)).toBe("reception");
    expect(formSubmissionSection(["n-unload"], false)).toBe("unloading");
    expect(formSubmissionSection(["n-qfs"], true)).toBe("unit_reception");
  });

  it("lists rejected first, then what is to do, then what waits, each by section", () => {
    const item = (key: string, state: QualityCheckItem["state"], section: QualityCheckItem["section"]): QualityCheckItem =>
      ({ key, state, section, title: "", reference: "", missing: [], warehouse: "", since: null, link: { kind: "receipt", receiptId: "", stageId: "" } });
    const sorted = sortQualityItems([item("a", "waiting_approval", "reception"), item("b", "to_do", "drying"), item("c", "to_do", "reception"), item("d", "rejected", "production")]);
    expect(sorted.map((i) => i.key)).toEqual(["d", "c", "b", "a"]);
  });
});

describe("a QFS Officer's check, as typed", () => {
  it("needs the moisture of a drying sample, and a result after drying", () => {
    expect(qualitySubmissionProblem("drying_before", {})).toMatch(/Nothing to send/);
    expect(qualitySubmissionProblem("drying_before", { inputNutCount: "180" })).toMatch(/Moisture before drying is required/);
    expect(qualitySubmissionProblem("drying_before", { inputMoisture: "12.5" })).toBeUndefined();
    expect(qualitySubmissionProblem("drying_after", { outputMoisture: "8" })).toMatch(/Choose the result/);
    expect(qualitySubmissionProblem("drying_after", { outputMoisture: "8", decision: "pass" })).toBeUndefined();
    expect(qualitySubmissionProblem("drying_after", { outputMoisture: "130", decision: "pass" })).toMatch(/between 0 and 100/);
  });

  it("refuses a value that isn't a number, or one that isn't part of the check", () => {
    expect(qualitySubmissionProblem("drying_before", { inputMoisture: "wet" })).toMatch(/Must be a number/);
    expect(qualitySubmissionProblem("triage", { moisturePct: "9", price: "400" })).toMatch(/Not part of this check: price/);
  });

  it("asks a transfer lot for all three readings, and triage for its moisture", () => {
    expect(qualitySubmissionProblem("transfer_lot", { moisture: "9" })).toMatch(/KOR: Required. Nut count: Required/);
    expect(qualitySubmissionProblem("transfer_lot", { moisture: "9", kor: "48", nutCount: "190" })).toBeUndefined();
    expect(qualitySubmissionProblem("triage", { moisturePct: "101" })).toMatch(/between 0 and 100/);
    expect(qualitySubmissionProblem("triage", { moisturePct: "9.5" })).toBeUndefined();
  });
});

describe("the Incharge's forms leave the quality to the QFS Officer", () => {
  it("weighs a transfer lot without its quality, but takes all three or none", () => {
    expect(lotWeighingProblems({ grossWeightKg: "40400", moisture: "", kor: "", nutCount: "" }, 500)).toEqual({});
    expect(Object.keys(lotWeighingProblems({ grossWeightKg: "40400", moisture: "9", kor: "", nutCount: "" }, 500)).sort()).toEqual(["kor", "nutCount"]);
  });

  it("holds a weighed lot with no quality until it has one", () => {
    expect(transferLotStatus(true, 500, 0, 0, false)).toBe("waiting_quality");
    expect(transferLotStatus(true, 500, 0, 0, true)).toBe("ready");
    expect(transferLotStatus(false, 500, 0, 0, false)).toBe("waiting_weight");
  });

  it("records a triage without its moisture, and still refuses an impossible one", () => {
    const triage = { category: "triage", locationFrom: "BIN-1", quantityBeforeKg: "1000", quantityAfterKg: "980" };
    expect(activityProblems(triage)).toEqual([]);
    expect(activityProblems({ ...triage, moisturePct: "140" })).toEqual(["Moisture after triage must be between 0 and 100."]);
  });
});

describe("every warehouse number has a usual range from the workbooks (26 Nov 2026)", () => {
  // The two with no workbook column to derive one from: a warehouse's whole stock, and the free activity ledger's quantity.
  const NO_DATA = new Set(["n-stock / Closing stock (kg)", "n-ledger / Quantity"]);

  it("on a truck's forms", async () => {
    const { FIELD_RULES } = await import("../src/domain/fieldRules");
    for (const [stageId, fields] of Object.entries(FIELD_RULES)) {
      for (const [label, rule] of Object.entries(fields)) {
        if (!("number" in rule) || NO_DATA.has(`${stageId} / ${label}`)) continue;
        expect(rule.number.usual, `${stageId} / ${label}`).toBeDefined();
      }
    }
  });

  it("on the drying and transfer forms", async () => {
    const { TRANSFER_NUMBER_RULES } = await import("../src/domain/transferLot");
    const { dryingFieldProblem } = await import("../src/domain/sunDrying");
    for (const [kind, rule] of Object.entries(TRANSFER_NUMBER_RULES)) expect((rule as { usual?: unknown }).usual, kind).toBeDefined();
    // A possible value far outside the usual range only warns (soft): it still saves.
    const unusual = { inputMoisture: "30", outputMoisture: "2", inputNutCount: "300", inputKor: "60", issuedNetKg: "500000", receivedBags: "5000", inputShellG: "900", outputOilG: "60" };
    for (const [key, value] of Object.entries(unusual)) expect(dryingFieldProblem(key, value)?.soft, key).toBe(true);
  });

  it("is a real range: min below max, from real readings", async () => {
    const { USUAL_RANGES } = await import("../src/data/fieldRanges");
    for (const [key, r] of Object.entries(USUAL_RANGES)) {
      expect(r.min, key).toBeLessThan(r.max);
      expect(r.n, key).toBeGreaterThan(50);
    }
  });
});
