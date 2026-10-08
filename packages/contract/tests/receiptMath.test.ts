import { describe, it, expect } from "vitest";
import {
  computeDerivedFields, isDerivedField, parseQty, formatQty, dryingLoss, DERIVED_RULES, derivedRuleInForce, prefillSuggestions, storedFormulaMismatches, KOR_FACTOR,
} from "../src/domain/receiptMath.js";
import { STAGE_FIELD_MAP } from "../src/generated/stageFieldMap.js";

describe("parseQty", () => {
  it("reads the workbook's number shapes", () => {
    expect(parseQty("41300")).toBe(41300);
    expect(parseQty(" 41 300 ")).toBe(41300);
    expect(parseQty("44,94")).toBe(44.94);
    expect(parseQty("1,234.5")).toBe(1234.5);
  });

  it("keeps blank distinct from zero", () => {
    expect(parseQty("")).toBeUndefined();
    expect(parseQty("  ")).toBeUndefined();
    expect(parseQty("n/a")).toBeUndefined();
    expect(parseQty("0")).toBe(0);
  });

  it("formats without float noise", () => {
    expect(formatQty(40762)).toBe("40762");
    expect(formatQty(0.1 + 0.2)).toBe("0.3");
    expect(formatQty(-0)).toBe("0");
  });
});

describe("derived fields", () => {
  it("every rule names real stage fields", () => {
    for (const r of DERIVED_RULES) {
      for (const [stageId, label] of [r.target, ...r.inputs]) {
        expect(STAGE_FIELD_MAP[stageId]?.fields.some((f) => f.label === label), `${stageId} / ${label}`).toBe(true);
      }
    }
  });

  it("reproduces the real sample receipt (Truck Reception row 1)", () => {
    // 463 good + 0 damp + 15 torn = 478 bags; 41300 − 478 = 40822 net; − 60 refraction = 40762 paid;
    // × 470 CFA = 19,158,140 — every figure as the workbook records it.
    const out = computeDerivedFields({
      "n-gross": { "GROSS WT KGS": "41300" },
      "n-unload": { "BON SACS (good bags)": "463", "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "15", Refraction: "60" },
      "n-grn": { PRICE: "470" },
    });
    expect(out["n-unload"]!["SACS (bags)"]).toBe("478");
    expect(out["n-netwt"]).toEqual({ "NET WT KGS": "40822", "PAID WT": "40762" });
    expect(out["n-grn"]!.AMOUNT).toBe("19158140");
  });

  it("flows a new weighbridge reading through gross, net, paid and amount", () => {
    const out = computeDerivedFields({
      "n-gross": { "Loaded truck weight (kg)": "56300" },
      "n-tare": { "Tare / empty truck weight (kg)": "15000" },
      "n-unload": { "BON SACS (good bags)": "463", "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "15", Refraction: "60" },
      "n-grn": { PRICE: "470" },
    });
    expect(out["n-gross"]!["GROSS WT KGS"]).toBe("41300");
    expect(out["n-grn"]!.AMOUNT).toBe("19158140");
  });

  it("never blanks an imported gross that has no loaded/empty readings behind it", () => {
    const out = computeDerivedFields({ "n-gross": { "GROSS WT KGS": "41300" }, "n-tare": {} });
    expect(out["n-gross"]).toBeUndefined();
  });

  it("skips a rule whose inputs are incomplete", () => {
    const out = computeDerivedFields({ "n-unload": { "BON SACS (good bags)": "463", "Sacs déchirés (torn bags)": "15" } });
    expect(out).toEqual({});
  });

  it("knows which fields nobody may type", () => {
    expect(isDerivedField("n-netwt", "NET WT KGS")).toBe(true);
    expect(isDerivedField("n-unload", "SACS (bags)")).toBe(true);
    expect(isDerivedField("n-unload", "BON SACS (good bags)")).toBe(false);
  });
});

describe("KOR from the cut test", () => {
  const sample = (good: string, immature: string, spotted: string) => ({
    "n-qfs": { "Sample – Good Kernel (g)": good, "Sample – Immature (g)": immature, "Sample – Spotted (g)": spotted },
  });

  it("uses the client's own formula and constant", () => {
    expect(KOR_FACTOR).toBe(0.17637);
    // (270 + 0.5 × (30 + 20)) × 0.17637 = 295 × 0.17637 = 52.03 — rounded to the two decimals the sheets hold.
    expect(computeDerivedFields(sample("270", "30", "20"))["n-qfs"]).toEqual({ KOR: "52.03" });
  });

  it("calculates the sample panel into KOR and the final panel into FINAL KOR, independently", () => {
    const out = computeDerivedFields({
      "n-qfs": {
        ...sample("270", "30", "20")["n-qfs"],
        "Final – Good Kernel (g)": "280", "Final – Immature (g)": "10", "Final – Spotted (g)": "10",
      },
    })["n-qfs"];
    expect(out).toEqual({ KOR: "52.03", "FINAL KOR": "51.15" });
  });

  it("needs all three of good, immature and spotted — a zero counts, a blank does not", () => {
    expect(computeDerivedFields(sample("270", "30", ""))["n-qfs"]).toBeUndefined();
    expect(computeDerivedFields(sample("270", "0", "0"))["n-qfs"]).toEqual({ KOR: "47.62" });
  });

  it("is typed until the grams exist, then calculated — and never locks a truck that only has the final KOR", () => {
    const typedOnly = { "n-qfs": { KOR: "47.69", "FINAL KOR": "48.4" } };
    expect(derivedRuleInForce(typedOnly, "n-qfs", "KOR")).toBeUndefined();
    expect(derivedRuleInForce(sample("270", "30", ""), "n-qfs", "KOR")).toBeUndefined();
    expect(derivedRuleInForce(sample("270", "30", "20"), "n-qfs", "KOR")?.formula).toMatch(/0\.17637/);
    // Final panel is separate: sample grams don't lock FINAL KOR.
    expect(derivedRuleInForce(sample("270", "30", "20"), "n-qfs", "FINAL KOR")).toBeUndefined();
    // A rule with no fallback is locked regardless of its inputs.
    expect(derivedRuleInForce({}, "n-netwt", "NET WT KGS")).toBeDefined();
  });

  it("never blanks an imported typed KOR that has no grams behind it", () => {
    expect(computeDerivedFields({ "n-qfs": { KOR: "47.69" } })["n-qfs"]).toBeUndefined();
    expect(storedFormulaMismatches({ "n-qfs": { KOR: "47.69", "FINAL KOR": "48.4" } })).toEqual([]);
  });

  it("reports a stored KOR that disagrees with the grams recorded beside it", () => {
    expect(storedFormulaMismatches({ "n-qfs": { KOR: "47.69", ...sample("270", "30", "20")["n-qfs"] } })).toEqual([
      { stageId: "n-qfs", label: "KOR", stored: "47.69", expected: "52.03" },
    ]);
  });
});

describe("GRN quantity is suggested from net, never forced", () => {
  const GRN = "GRN Weight (kept separate from Gross/Net/Paid)";

  it("offers the net weight when GRN is empty", () => {
    expect(prefillSuggestions({ "n-netwt": { "NET WT KGS": "40822" } }, "n-grn")).toEqual({ [GRN]: { value: "40822", from: "net weight" } });
  });

  it("offers nothing once GRN has a value — even one that differs from net", () => {
    expect(prefillSuggestions({ "n-netwt": { "NET WT KGS": "40822" }, "n-grn": { [GRN]: "40700" } }, "n-grn")).toEqual({});
  });

  it("offers nothing without a net weight, or for another stage", () => {
    expect(prefillSuggestions({}, "n-grn")).toEqual({});
    expect(prefillSuggestions({ "n-netwt": { "NET WT KGS": "40822" } }, "n-lot")).toEqual({});
  });

  it("is not a calculation: GRN stays typeable", () => {
    expect(isDerivedField("n-grn", GRN)).toBe(false);
  });
});

describe("dryingLoss", () => {
  it("is issued net − received net, and that over issued", () => {
    expect(dryingLoss(10000, 9600)).toEqual({ kg: 400, pct: 0.04 });
  });

  it("is undefined without both weights", () => {
    expect(dryingLoss(undefined, 9600)).toBeUndefined();
    expect(dryingLoss(0, 0)).toBeUndefined();
  });
});
