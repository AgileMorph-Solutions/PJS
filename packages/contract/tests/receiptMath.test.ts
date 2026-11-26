import { describe, it, expect } from "vitest";
import {
  computeDerivedFields, isDerivedField, parseQty, formatQty, dryingLoss, DERIVED_RULES, derivedRuleInForce, prefillSuggestions, stockFillOnGrn, storedFormulaMismatches, staleDerivedFields, followingTotals, KOR_FACTOR,
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
      "n-gross": { "Loaded truck weight (kg)": "56300", "Tare / empty truck weight (kg)": "15000" },
      "n-unload": { "BON SACS (good bags)": "463", "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "15", Refraction: "60" },
      "n-grn": { PRICE: "470" },
    });
    expect(out["n-gross"]!["GROSS WT KGS"]).toBe("41300");
    expect(out["n-grn"]!.AMOUNT).toBe("19158140");
  });

  it("never blanks an imported gross that has no loaded/empty readings behind it", () => {
    const out = computeDerivedFields({ "n-gross": { "GROSS WT KGS": "41300", "Tare / empty truck weight (kg)": "" } });
    expect(out["n-gross"]).toBeUndefined();
  });

  it("keeps the tare in the gross weight step (Oct 2026): a gross typed from the ticket stands until both readings exist", () => {
    expect(computeDerivedFields({ "n-gross": { "GROSS WT KGS": "41300", "Loaded truck weight (kg)": "56300" } })["n-gross"]).toBeUndefined();
    expect(computeDerivedFields({ "n-gross": { "GROSS WT KGS": "41300", "Loaded truck weight (kg)": "56300", "Tare / empty truck weight (kg)": "15100" } })["n-gross"]!["GROSS WT KGS"]).toBe("41200");
  });

  it("skips a rule whose inputs are incomplete", () => {
    const out = computeDerivedFields({ "n-unload": { "BON SACS (good bags)": "463", "Sacs déchirés (torn bags)": "15" } });
    expect(out).toEqual({});
  });

  it("knows which fields are calculated, and that good bags are typed (20 Nov 2026)", () => {
    expect(isDerivedField("n-netwt", "NET WT KGS")).toBe(true);
    expect(isDerivedField("n-unload", "SACS (bags)")).toBe(true);
    expect(isDerivedField("n-unload", "BON SACS (good bags)")).toBe(false);
    expect(isDerivedField("n-unload", "Tally Clerk bag count")).toBe(true);
  });
});

// 20 Nov 2026: good, damp and torn are typed; SACS = their total and the tally = good + reconditioned, both calculated.
describe("bags at unloading", () => {
  const unload = (v: Record<string, string>) => ({ "n-unload": v });

  it("calculates the total and the tally from the typed counts", () => {
    const out = computeDerivedFields(unload({ "BON SACS (good bags)": "463", "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "15", "Reconditioning of torn bags": "10" }));
    expect(out["n-unload"]).toEqual({ "SACS (bags)": "478", "Tally Clerk bag count": "473" }); // 463 + 0 + 15; 463 + 10
  });

  // 25 Nov 2026: both bag totals are filled in from the counts, but a person may type their own.
  it("never locks SACS or the tally: a person may type over them", () => {
    const counts = unload({ "BON SACS (good bags)": "463", "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "15", "Reconditioning of torn bags": "10" });
    expect(derivedRuleInForce(counts, "n-unload", "SACS (bags)")).toBeUndefined();
    expect(derivedRuleInForce(counts, "n-unload", "Tally Clerk bag count")).toBeUndefined();
  });

  const counts = (good: string) => ({ "BON SACS (good bags)": good, "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "15", "Reconditioning of torn bags": "10" });

  it("keeps the calculated total up to date while nobody has typed over it", () => {
    const before = unload({ ...counts("463"), "SACS (bags)": "478", "Tally Clerk bag count": "473" });
    const after = unload({ ...counts("470"), "SACS (bags)": "478", "Tally Clerk bag count": "473" });
    expect(computeDerivedFields(after, before)["n-unload"]).toEqual({ "SACS (bags)": "485", "Tally Clerk bag count": "480" });
  });

  it("keeps a total a person typed while its counts stay as they are, and works Net out from it", () => {
    const typed = { ...unload({ ...counts("463"), "SACS (bags)": "480", "Tally Clerk bag count": "475" }), "n-gross": { "GROSS WT KGS": "30000" } };
    const out = computeDerivedFields(typed, { ...typed, "n-gross": {} }); // something else changed, not the counts
    expect(out["n-unload"]).toBeUndefined();
    expect(out["n-netwt"]?.["NET WT KGS"]).toBe("29520"); // 30000 − 480 bags at 1 kg
  });

  // The last edit wins (25 Nov 2026): a typed total holds only until a count changes.
  it("recalculates a typed total once one of its counts changes", () => {
    const typed = { "SACS (bags)": "480", "Tally Clerk bag count": "475" };
    const out = computeDerivedFields(unload({ ...counts("470"), ...typed }), unload({ ...counts("463"), ...typed }));
    expect(out["n-unload"]).toEqual({ "SACS (bags)": "485", "Tally Clerk bag count": "480" });
  });

  // What the form saves with each keystroke of a count, so the total moves as it is typed.
  it("followingTotals: a changed count moves its totals as it is typed, or empties them", () => {
    const calc = unload({ ...counts("463"), "SACS (bags)": "478", "Tally Clerk bag count": "473" });
    const typing = (good: string, from = calc) => followingTotals(from, unload({ ...from["n-unload"], "BON SACS (good bags)": good }));
    expect(typing("47")).toEqual({ "n-unload": { "SACS (bags)": "62", "Tally Clerk bag count": "57" } });
    expect(typing("")).toEqual({ "n-unload": { "SACS (bags)": "", "Tally Clerk bag count": "" } });
    // The screenshot of 25 Nov 2026: Tally stuck at 12 after good bags went to 2 with no reconditioned bags. It follows now.
    const stuck = unload({ "BON SACS (good bags)": "12", "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "5", "Reconditioning of torn bags": "0", "SACS (bags)": "17", "Tally Clerk bag count": "12" });
    expect(typing("2", { "n-unload": { ...stuck["n-unload"], "Tally Clerk bag count": "99" } }))
      .toEqual({ "n-unload": { "SACS (bags)": "7", "Tally Clerk bag count": "2" } });
    // A count the total doesn't use leaves it alone: reconditioning doesn't touch SACS.
    expect(followingTotals(stuck, unload({ ...stuck["n-unload"], "Reconditioning of torn bags": "3" }))).toEqual({ "n-unload": { "Tally Clerk bag count": "15" } });
  });

  it("clearing a typed total hands it back to the calculation", () => {
    const before = unload({ ...counts("463"), "SACS (bags)": "480" });
    expect(computeDerivedFields(unload({ ...counts("463"), "SACS (bags)": "" }), before)["n-unload"]?.["SACS (bags)"]).toBe("478");
  });

  it("keeps an imported total that disagrees with its parts, and reports it rather than correcting it", () => {
    // 44 real Truck Reception rows are like this; the stored total stands and is reported.
    expect(storedFormulaMismatches(unload({ "SACS (bags)": "480", "BON SACS (good bags)": "463", "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "15" })))
      .toEqual([{ stageId: "n-unload", label: "SACS (bags)", stored: "480", expected: "478" }]);
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

  it("is never typed in the app; an upload keeps its sheet's KOR until the grams exist — so a truck with only the final KOR still uploads", () => {
    const typedOnly = { "n-qfs": { KOR: "47.69", "FINAL KOR": "48.4" } };
    // In the app (Nov 2026): KOR is only ever the cut test's result, grams or not.
    expect(derivedRuleInForce(typedOnly, "n-qfs", "KOR")?.formula).toMatch(/0\.17637/);
    expect(derivedRuleInForce({}, "n-qfs", "FINAL KOR")).toBeDefined();
    // From an upload: the client's sheets hold KOR without the grams, so it is typed until they exist.
    expect(derivedRuleInForce(typedOnly, "n-qfs", "KOR", "upload")).toBeUndefined();
    expect(derivedRuleInForce(sample("270", "30", ""), "n-qfs", "KOR", "upload")).toBeUndefined();
    expect(derivedRuleInForce(sample("270", "30", "20"), "n-qfs", "KOR", "upload")?.formula).toMatch(/0\.17637/);
    // Final panel is separate: sample grams don't lock FINAL KOR in an upload.
    expect(derivedRuleInForce(sample("270", "30", "20"), "n-qfs", "FINAL KOR", "upload")).toBeUndefined();
    // A rule with no fallback is locked regardless of its inputs.
    expect(derivedRuleInForce({}, "n-gross", "GROSS WT KGS")).toBeDefined();
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

describe("sample and final moisture / nut count (Nov 2026)", () => {
  const allReadings = {
    "n-qfs": { "Sample moisture (%)": "12,4", "Sample nut count": "180", "Final moisture (%)": "10,2", "Final nut count": "172" },
  };

  it("all four are typed by hand: nothing calculates, overwrites or locks them", () => {
    expect(computeDerivedFields(allReadings)["n-qfs"]).toBeUndefined();
    for (const label of Object.keys(allReadings["n-qfs"])) expect(derivedRuleInForce(allReadings, "n-qfs", label)).toBeUndefined();
    expect(storedFormulaMismatches(allReadings)).toEqual([]);
  });

  it("the final reading is the truck's only moisture / nut count: MOIS. and NUT COUNT are gone", () => {
    const labels = STAGE_FIELD_MAP["n-qfs"]!.fields.map((f) => f.label);
    expect(labels).toEqual(expect.arrayContaining(["Final moisture (%)", "Final nut count"]));
    expect(labels).not.toContain("MOIS. (moisture)");
    expect(labels).not.toContain("NUT COUNT");
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

// Found 20 Nov 2026 on REC-YAK-2026-0317: Spotted was cleared, KOR kept 18.61 — a value its grams could no longer give.
describe("a calculated value whose input is cleared", () => {
  const qfs = (g: string, i: string, sp: string, kor: string) => ({ "n-qfs": { "Sample – Good Kernel (g)": g, "Sample – Immature (g)": i, "Sample – Spotted (g)": sp, KOR: kor } });

  it("is blanked when the app had worked it out (the real case: Spotted 10 → 18.61, then Spotted cleared)", () => {
    const before = qfs("100", "1", "10", "18.61");
    expect(computeDerivedFields(before)["n-qfs"]!.KOR).toBe("18.61"); // the 18.61 on the screen came from Spotted 10
    expect(staleDerivedFields(qfs("100", "1", "", "18.61"), before)).toEqual({ "n-qfs": { KOR: "" } });
  });

  it("is kept when an upload brought it in with nothing behind it (a sheet's KOR without grams)", () => {
    const imported = { "n-qfs": { KOR: "47.2" } };
    expect(staleDerivedFields({ "n-qfs": { KOR: "47.2", "Sample – Good Kernel (g)": "" } }, imported)).toEqual({});
  });

  it("is left alone while its inputs are all still there", () => {
    const before = qfs("100", "1", "10", "18.61");
    expect(staleDerivedFields(qfs("100", "1", "12", "18.61"), before)).toEqual({});
  });

  it("clears what was worked out from it too: no empty-truck weight, so no gross, net or paid", () => {
    const before = {
      "n-gross": { "Loaded truck weight (kg)": "56300", "Tare / empty truck weight (kg)": "15000", "GROSS WT KGS": "41300" },
      "n-unload": { "SACS (bags)": "478", Refraction: "60" },
      "n-netwt": { "NET WT KGS": "40822", "PAID WT": "40762" },
    };
    const after = { ...before, "n-gross": { ...before["n-gross"], "Tare / empty truck weight (kg)": "" } };
    expect(staleDerivedFields(after, before)).toEqual({ "n-gross": { "GROSS WT KGS": "" }, "n-netwt": { "NET WT KGS": "", "PAID WT": "" } });
  });
});

describe("warehouse stock step (Nov 2026)", () => {
  const ready = { "n-netwt": { "NET WT KGS": "40762" }, "n-unload": { "SACS (bags)": "478" } };

  const ADDED = "Added to stock from this truck (kg)";

  it("offers net weight less the jute bags as what is added to stock, and the person may type another figure", () => {
    expect(prefillSuggestions(ready, "n-stock")[ADDED]).toEqual({ value: "40284", from: "net weight − 1 kg per bag" });
    expect(derivedRuleInForce({ ...ready, "n-stock": {} }, "n-stock", ADDED)).toBeUndefined();
    // Once a figure is there, typed or taken, nothing is offered over it.
    expect(prefillSuggestions({ ...ready, "n-stock": { [ADDED]: "40000" } }, "n-stock")[ADDED]).toBeUndefined();
  });

  it("totals closing stock with whatever was added, typed or taken from the suggestion", () => {
    const out = computeDerivedFields({ ...ready, "n-stock": { "Closing stock (kg)": "100000", [ADDED]: "40000" } });
    expect(out["n-stock"]).toEqual({ "Total warehouse stock after this truck (kg)": "140000" });
  });

  it("leaves the total blank until closing stock is typed", () => {
    expect(computeDerivedFields({ ...ready, "n-stock": { [ADDED]: "40284" } })["n-stock"]).toBeUndefined();
  });

  // Writing into a step creates it, and its presence alone makes the truck "in_stock" — a net weight must not do that.
  it("never starts the stock step on its own", () => {
    expect(computeDerivedFields(ready)["n-stock"]).toBeUndefined();
  });

  it("the total is read-only; closing stock and what was added are typed", () => {
    expect(derivedRuleInForce({}, "n-stock", "Total warehouse stock after this truck (kg)")).toBeDefined();
    expect(derivedRuleInForce({}, "n-stock", "Closing stock (kg)")).toBeUndefined();
  });
});

describe("stock filled in when the GRN completes (23 Nov 2026)", () => {
  const data = { "n-netwt": { "NET WT KGS": "40000" }, "n-unload": { "SACS (bags)": "420" } };
  it("is the net weight less 1 kg a bag, once the GRN is complete", () => {
    expect(stockFillOnGrn(data, true)).toEqual({ "Added to stock from this truck (kg)": "39580" });
    expect(stockFillOnGrn(data, false)).toEqual({});
  });
  it("never replaces a figure already there, and needs both readings", () => {
    expect(stockFillOnGrn({ ...data, "n-stock": { "Added to stock from this truck (kg)": "39000" } }, true)).toEqual({});
    expect(stockFillOnGrn({ "n-netwt": { "NET WT KGS": "40000" } }, true)).toEqual({});
  });
});

// 26 Nov 2026 (user): Net and Paid fill themselves in but stay editable; a typed figure stands until an input changes.
describe("net and paid weight: calculated, but the warehouse may type over them", () => {
  const truck = { "n-gross": { "GROSS WT KGS": "41300" }, "n-unload": { "SACS (bags)": "478", Refraction: "60" } };
  it("are filled in from gross, bags and refraction", () => {
    expect(computeDerivedFields(truck)["n-netwt"]).toEqual({ "NET WT KGS": "40822", "PAID WT": "40762" });
  });
  it("are never locked, so a person can type them", () => {
    expect(derivedRuleInForce(truck, "n-netwt", "NET WT KGS")).toBeUndefined();
    expect(derivedRuleInForce(truck, "n-netwt", "PAID WT")).toBeUndefined();
  });
  it("a typed net is kept, and paid and the amount follow it", () => {
    const before = { ...truck, "n-netwt": { "NET WT KGS": "40822", "PAID WT": "40762" }, "n-grn": { PRICE: "470" } };
    const after = { ...before, "n-netwt": { "NET WT KGS": "40000", "PAID WT": "40762" } };
    const out = computeDerivedFields(after, before);
    expect(out["n-netwt"]?.["NET WT KGS"]).toBeUndefined(); // the person's figure stays
    expect(out["n-netwt"]?.["PAID WT"]).toBe("39940");
    expect(out["n-grn"]?.AMOUNT).toBe(String(39940 * 470));
  });
  it("a typed paid weight is kept until net or refraction changes", () => {
    const before = { ...truck, "n-netwt": { "NET WT KGS": "40822", "PAID WT": "40762" } };
    const typed = { ...before, "n-netwt": { "NET WT KGS": "40822", "PAID WT": "40700" } };
    expect(computeDerivedFields(typed, before)["n-netwt"]?.["PAID WT"]).toBeUndefined();
    const refr = { ...typed, "n-unload": { ...truck["n-unload"], Refraction: "100" } };
    expect(computeDerivedFields(refr, typed)["n-netwt"]?.["PAID WT"]).toBe("40722");
  });
});
