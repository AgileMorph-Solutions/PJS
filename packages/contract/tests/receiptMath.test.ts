import { describe, it, expect } from "vitest";
import { computeDerivedFields, isDerivedField, parseQty, formatQty, dryingLoss, DERIVED_RULES } from "../src/domain/receiptMath.js";
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

describe("dryingLoss", () => {
  it("is issued net − received net, and that over issued", () => {
    expect(dryingLoss(10000, 9600)).toEqual({ kg: 400, pct: 0.04 });
  });

  it("is undefined without both weights", () => {
    expect(dryingLoss(undefined, 9600)).toBeUndefined();
    expect(dryingLoss(0, 0)).toBeUndefined();
  });
});
