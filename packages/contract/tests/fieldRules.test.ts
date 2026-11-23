/**
 * docs/procurement-field-rules.png: what a typed value may be, which values must agree, and the order phases open in. One
 * case per rule in the image, so a rule that stops working is named.
 */
import { describe, it, expect } from "vitest";
import { FIELD_RULES, checkValue, isNoFutureDate, recordIssues } from "../src/domain/fieldRules";
import { stageGate, passBlocked, decisionGate, PHASES } from "../src/domain/phaseGate";
import { STAGE_FIELD_MAP } from "../src/generated/stageFieldMap";
import { fieldChoices } from "../src/data/fieldChoices";
import { autoFill, weekLabel } from "../src/data/autoFields";
import { prefillSuggestions } from "../src/domain/receiptMath";

const ctx = { today: "2026-11-16", arrivalDate: "2026-11-14" };
// Every rule only warns (Nov 2026: "all values can be saved, just warn the user"), so a value is either fine or flagged.
const level = (stageId: string, label: string, v: string) => (checkValue(stageId, label, v) ? "warn" : undefined);

describe("every rule names a real field", () => {
  it("FIELD_RULES labels exist in the spec", () => {
    for (const [stageId, fields] of Object.entries(FIELD_RULES)) {
      for (const label of Object.keys(fields)) expect(STAGE_FIELD_MAP[stageId]?.fields.some((f) => f.label === label), `${stageId} / ${label}`).toBe(true);
    }
  });
});

describe("one value on its own", () => {
  it("blank is never wrong: it is 'not recorded yet'", () => {
    expect(checkValue("n-qfs", "Sample moisture (%)", "")).toBeUndefined();
  });

  it("Quality (QFS) readings have no limits of their own: nothing warns on one reading alone (20 Nov 2026)", () => {
    for (const [label, v] of [["Sample moisture (%)", "30"], ["Final moisture (%)", "100.5"], ["Sample nut count", "240"], ["Final nut count", "172.5"],
      ["KOR", "75"], ["FINAL KOR", "41"], ["Sample – Good Kernel (g)", "1243"]] as const) {
      expect(level("n-qfs", label, v), label).toBeUndefined();
    }
    // Still a number: text is pointed out, so the mismatch check has something to compare.
    expect(level("n-qfs", "Sample moisture (%)", "abc")).toBe("warn");
  });

  it("drying moisture keeps its limits: above 10 % warns that it needs drying", () => {
    expect(level("n-drying", "Moisture % — after drying", "9.5")).toBeUndefined();
    expect(level("n-drying", "Moisture % — after drying", "12")).toBe("warn");
  });

  it("the French decimal comma the real sheets use is a number", () => {
    expect(level("n-qfs", "KOR", "47,69")).toBeUndefined();
  });

  it("weights and price must be more than 0; gross above 60,000 kg warns", () => {
    expect(level("n-gross", "Loaded truck weight (kg)", "0")).toBe("warn");
    expect(level("n-gross", "GROSS WT KGS", "41300")).toBeUndefined();
    expect(level("n-gross", "GROSS WT KGS", "116480")).toBe("warn");
    expect(level("n-grn", "PRICE", "0")).toBe("warn");
  });

  it("bags are whole numbers; more than 750 good bags warns", () => {
    expect(level("n-unload", "BON SACS (good bags)", "463")).toBeUndefined();
    expect(level("n-unload", "BON SACS (good bags)", "800")).toBe("warn");
    expect(level("n-unload", "Sacs déchirés (torn bags)", "1.5")).toBe("warn");
  });

  it("fiche number digits only, fiche code and plate format: each warns when it doesn't fit", () => {
    expect(level("n-verify", "FICHE", "72515")).toBeUndefined();
    expect(level("n-verify", "FICHE", "72-515")).toBe("warn");
    expect(level("n-verify", "FICHE CODE", "0401-0007")).toBeUndefined();
    expect(level("n-verify", "FICHE CODE", "401/7")).toBe("warn");
    // A plain number is a FICHE CODE the team uses too (Nov 2026): never warned about.
    expect(checkValue("n-verify", "FICHE CODE", "77583")).toBeUndefined();
    expect(level("n-gate", "VEHICLE NO.", "4972KB01/9901KD01")).toBeUndefined();
    expect(level("n-gate", "VEHICLE NO.", "7957-GN-01")).toBeUndefined();
    expect(level("n-gate", "VEHICLE NO.", "827 KT 01!")).toBe("warn");
  });
});

describe("other warehouse activities (20 Nov 2026)", () => {
  it("re-bagging and destacking are whole bags, triage metric tons: text or a part bag only warns", () => {
    expect(checkValue("n-otheract", "Re-bagging (damaged/torn bags)", "abc")?.message).toBe(`"abc" isn't a number.`);
    expect(checkValue("n-otheract", "Destacking", "12.5")?.message).toBe("Not a whole number.");
    expect(checkValue("n-otheract", "Destacking", "40")).toBeUndefined();
    expect(checkValue("n-otheract", "Triage (quality + quantity + moisture check)", "two")?.message).toBe(`"two" isn't a number.`);
    expect(checkValue("n-otheract", "Triage (quality + quantity + moisture check)", "1.5")).toBeUndefined();
  });
});

describe("values that must agree", () => {
  const ids = (sd: Record<string, Record<string, string>>) => recordIssues(sd, ctx).map((i) => i.label);
  // Team, 23 Nov 2026: closing stock is the old stock plus this truck, so this truck can't add more than it.
  it("warns when one truck adds more to stock than the closing stock, which includes it", () => {
    const stock = (added: string, closing: string) => recordIssues({ "n-stock": { "Added to stock from this truck (kg)": added, "Closing stock (kg)": closing } }, ctx);
    const [w] = stock("1000000", "5000");
    expect(w).toMatchObject({ stageId: "n-stock", label: "Added to stock from this truck (kg)" });
    expect(w!.message).toMatch(/more than the closing stock \(5,000 kg\)/);
    expect(stock("39580", "45000")).toEqual([]);
    expect(stock("39580", "39580")).toEqual([]); // an empty warehouse before this truck
    expect(recordIssues({ "n-stock": { "Added to stock from this truck (kg)": "39580" } }, ctx)).toEqual([]); // closing not typed yet
  });

  it("the empty truck can't weigh as much as the loaded one", () => {
    expect(ids({ "n-gross": { "Loaded truck weight (kg)": "15000", "Tare / empty truck weight (kg)": "16000" } }))
      .toContain("Tare / empty truck weight (kg)");
  });

  it("an arrival before the day the record was entered warns lightly; the same day doesn't", () => {
    const entered = { ...ctx, enteredOn: "2026-11-14" };
    const at = (d: string) => recordIssues({ "n-gate": { "DATE OF ARRIVAL": d } }, entered).map((i) => i.message);
    expect(at("2026-11-10")).toEqual(["A past date: this record was entered on 14/11/2026. Please check it."]);
    expect(at("2026-11-14")).toEqual([]);
  });

  it("arrival and offloading can't be picked in the future; other dates can", () => {
    expect(isNoFutureDate("n-gate", "DATE OF ARRIVAL")).toBe(true);
    expect(isNoFutureDate("n-unload", "DATE OF OFFLOADING")).toBe(true);
    expect(isNoFutureDate("n-gate", "REMARKS")).toBe(false);
  });

  it("dates: no arrival in the future, no offloading before arrival", () => {
    expect(ids({ "n-gate": { "DATE OF ARRIVAL": "2026-12-01" } })).toContain("DATE OF ARRIVAL");
    expect(ids({ "n-unload": { "DATE OF OFFLOADING": "2026-11-12" } })).toContain("DATE OF OFFLOADING");
    expect(ids({ "n-unload": { "DATE OF OFFLOADING": "2026-11-15" } })).not.toContain("DATE OF OFFLOADING");
  });

  it("refraction: more than 1 % of net warns (net is taken as the system calculates it)", () => {
    const base = { "n-gross": { "GROSS WT KGS": "41300" }, "n-unload": { "SACS (bags)": "478", "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "15" } };
    expect(ids({ ...base, "n-unload": { ...base["n-unload"], Refraction: "60" } })).not.toContain("Refraction");
    expect(ids({ ...base, "n-unload": { ...base["n-unload"], Refraction: "600" } })).toContain("Refraction");
    expect(ids({ ...base, "n-unload": { ...base["n-unload"], Refraction: "50000" } })).toContain("Refraction");
  });

  it("kg per bag far from 80 warns; the real first truck (41,300 kg, 478 bags = 86 kg) does not", () => {
    const sd = (bags: string) => ({ "n-gross": { "GROSS WT KGS": "41300" }, "n-unload": { "SACS (bags)": bags, "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "15" } });
    expect(ids(sd("478"))).not.toContain("GROSS WT KGS");
    expect(ids(sd("50"))).toContain("GROSS WT KGS");
  });

  it("more reconditioned than torn, or more torn than received; pallets too few; never a warning under damp bags", () => {
    const sd = { "n-unload": { "SACS (bags)": "478", "HUMID SACS (damp bags)": "30", "Sacs déchirés (torn bags)": "48", "Reconditioning of torn bags": "50", "Pallets used (30 bags/pallet)": "10" } };
    expect(ids(sd)).toEqual(expect.arrayContaining(["Reconditioning of torn bags", "Pallets used (30 bags/pallet)"]));
    // 20 Nov 2026: a high share of damp or torn bags is no longer pointed out.
    expect(ids(sd)).not.toContain("HUMID SACS (damp bags)");
    expect(ids({ "n-unload": { "BON SACS (good bags)": "32", "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "7" } })).not.toContain("HUMID SACS (damp bags)");
    expect(ids({ "n-unload": { "SACS (bags)": "10", "Sacs déchirés (torn bags)": "15" } })).toContain("Sacs déchirés (torn bags)");
    // The tally is calculated now, so it is no longer checked against the total.
    expect(ids({ "n-unload": { "SACS (bags)": "478", "Tally Clerk bag count": "473" } })).not.toContain("Tally Clerk bag count");
  });

  it("good bags that aren't total − torn warn under good bags; matching ones don't (20 Nov 2026)", () => {
    // An imported row whose sheet holds its own total: 100 received, 10 torn, so 90 good — 110 typed warns.
    const msg = recordIssues({ "n-unload": { "SACS (bags)": "100", "Sacs déchirés (torn bags)": "10", "BON SACS (good bags)": "110" } }, ctx)
      .find((i) => i.label === "BON SACS (good bags)")?.message;
    expect(msg).toBe("Total bags (100) − torn bags (10) = 90, but good bags is 110. Please check.");
    expect(ids({ "n-unload": { "SACS (bags)": "100", "Sacs déchirés (torn bags)": "10", "BON SACS (good bags)": "90" } })).not.toContain("BON SACS (good bags)");
    // In the app the total is calculated (good + damp + torn), so damp bags are what make the two differ.
    expect(ids({ "n-unload": { "BON SACS (good bags)": "320", "HUMID SACS (damp bags)": "2", "Sacs déchirés (torn bags)": "7" } })).toContain("BON SACS (good bags)");
    expect(ids({ "n-unload": { "BON SACS (good bags)": "320", "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "7" } })).not.toContain("BON SACS (good bags)");
  });

  it("GRN quantity above net weight warns", () => {
    expect(ids({ "n-netwt": { "NET WT KGS": "40822" }, "n-grn": { "GRN Weight (kept separate from Gross/Net/Paid)": "42000" } }))
      .toContain("GRN Weight (kept separate from Gross/Net/Paid)");
  });

  it("moisture not dropping after drying warns; cut-test grams are no longer summed against the sample (20 Nov 2026)", () => {
    expect(ids({ "n-qfs": { "Sample – Good Kernel (g)": "800", "Sample – Shell (g)": "440" } })).toEqual([]);
    expect(ids({ "n-drying": { "Moisture % — before drying": "11.8", "Moisture % — after drying": "12.1" } })).toContain("Moisture % — after drying");
  });

  it("each final reading far from its truck-sampling twin warns, under the final one; close readings don't", () => {
    expect(ids({ "n-qfs": { "Sample moisture (%)": "2", "Final moisture (%)": "9" } })).toEqual(["Final moisture (%)"]);
    expect(ids({ "n-qfs": { "Sample moisture (%)": "9", "Final moisture (%)": "2" } })).toContain("Final moisture (%)");
    expect(ids({ "n-qfs": { "Sample moisture (%)": "8", "Final moisture (%)": "9.5" } })).toEqual([]);
    expect(ids({ "n-qfs": { "Sample nut count": "170", "Final nut count": "300" } })).toEqual(["Final nut count"]);
    expect(ids({ "n-qfs": { "Sample nut count": "300", "Final nut count": "300" } })).toEqual([]); // the screenshot's case: same reading, no warning
    expect(ids({ "n-qfs": { "Sample – Oil (g)": "10", "Final – Oil (g)": "200" } })).toEqual(["Final – Oil (g)"]);
    expect(ids({ "n-qfs": { "Sample – Oil (g)": "10", "Final – Oil (g)": "40" } })).toEqual([]);
    // KOR is calculated from the grams; a far one is pointed out too.
    expect(ids({ "n-qfs": { KOR: "47", "FINAL KOR": "40" } })).toContain("FINAL KOR");
    // One side alone is "not recorded yet", never a mismatch.
    expect(ids({ "n-qfs": { "Final nut count": "300" } })).toEqual([]);
  });

});

describe("phase order: a phase opens only when the one before is complete", () => {
  const arrival = {
    "n-gate": { "DATE OF ARRIVAL": "2026-11-14", "CREDIT/CASH": "CASH", "WH LOCATION": "BOUAKE", "VEHICLE NO.": "827KT01" },
    "n-verify": { "SUPPLIERS NAME": "SCOOP IMANE", "LBA CODE": "LBA-006-IMA", "FICHE CODE": "0401-0007", FICHE: "72515", ORIGIN: "DIANRA" },
  };

  it("Arrival is always open; Weight waits for every Arrival field and names what is missing", () => {
    expect(stageGate({ stageData: {}, branches: {} }, "n-gate").open).toBe(true);
    const g = stageGate({ stageData: { "n-gate": { "VEHICLE NO.": "827KT01" } }, branches: {} }, "n-gross");
    expect(g.open).toBe(false);
    expect(g.message).toMatch(/^Weight is locked\. Please finish Arrival first: /);
    expect(g.missing).toContain("ORIGIN");
    expect(stageGate({ stageData: arrival, branches: {} }, "n-gross").open).toBe(true);
  });

  it("Quality waits for the gross weight, which counts when calculated from the two weights", () => {
    expect(stageGate({ stageData: arrival, branches: {} }, "n-qfs").open).toBe(false);
    const weighed = { ...arrival, "n-gross": { "Loaded truck weight (kg)": "56000", "Tare / empty truck weight (kg)": "14700" } };
    expect(stageGate({ stageData: weighed, branches: {} }, "n-qfs").open).toBe(true);
  });

  it("Pass needs the sample moisture, nut count and KOR; Fail doesn't", () => {
    const weighed = { ...arrival, "n-gross": { "GROSS WT KGS": "41300" } };
    expect(passBlocked(weighed)).toMatch(/Truck sampling moisture/);
    // KOR isn't typed in the app: what is missing is the cut-test grams it is calculated from.
    expect(passBlocked(weighed)).toMatch(/Truck sampling – Good Kernel \(g\), Truck sampling – Immature \(g\)/);
    expect(passBlocked(weighed)).not.toMatch(/KOR/);
    expect(decisionGate({ stageData: weighed, branches: {} }, "n-qfs", "pass").open).toBe(false);
    expect(decisionGate({ stageData: weighed, branches: {} }, "n-qfs", "fail").open).toBe(true);
    // The grams give KOR; with them and the two readings, Pass may be chosen.
    const sampled = { ...weighed, "n-qfs": { "Sample moisture (%)": "9", "Sample nut count": "170", "Sample – Good Kernel (g)": "270", "Sample – Immature (g)": "30", "Sample – Spotted (g)": "20" } };
    expect(decisionGate({ stageData: sampled, branches: {} }, "n-qfs", "pass").open).toBe(true);
  });

  it("Unloading opens only on Pass; Bin waits for Unloading; GRN waits for a finalised Bin and the final readings", () => {
    const passed = { ...arrival, "n-gross": { "GROSS WT KGS": "41300" } };
    expect(stageGate({ stageData: passed, branches: {} }, "n-unload").message).toBe("Unloading is locked. The truck must pass Quality first.");
    expect(stageGate({ stageData: passed, branches: { "n-qfs": "pass" } }, "n-unload").open).toBe(true);
    expect(stageGate({ stageData: passed, branches: { "n-qfs": "pass" } }, "n-bin").waitingFor).toBe("Unloading");
    const unloaded = {
      ...passed,
      // The total and the tally are calculated from the typed counts and the reconditioned bags.
      "n-unload": { "DATE OF OFFLOADING": "2026-11-14", "BON SACS (good bags)": "463", "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "15", "Reconditioning of torn bags": "15", Refraction: "60" },
    };
    expect(stageGate({ stageData: unloaded, branches: { "n-qfs": "pass" } }, "n-bin").open).toBe(true);
    const binned = { ...unloaded, "n-bin": { "Bin Number": "BKE-002-BIN-003", "Basis for allocation (moisture / quality / KOR / space)": "Moisture" } };
    expect(stageGate({ stageData: binned, branches: { "n-qfs": "pass" } }, "n-grn").waitingFor).toBe("Bin");
    const finalised = { ...binned, "n-bin": { ...binned["n-bin"], "Bin allocation date": "2026-11-15" } };
    expect(stageGate({ stageData: finalised, branches: { "n-qfs": "pass" } }, "n-grn").waitingFor).toBe("Quality (final readings)");
    const finals = { ...finalised, "n-qfs": { "Final moisture (%)": "9", "Final nut count": "170", "FINAL KOR": "47" } };
    expect(stageGate({ stageData: finals, branches: { "n-qfs": "pass" } }, "n-grn").open).toBe(true);
  });

  it("Other activities, the ledger, transfer and the stock update wait for a complete GRN", () => {
    for (const s of ["n-otheract", "n-ledger", "n-xferdec", "n-stock"]) {
      expect(stageGate({ stageData: {}, branches: {} }, s).message).toMatch(/locked until the GRN is complete/);
      expect(stageGate({ stageData: { "n-grn": { PRICE: "470", "GRN Weight (kept separate from Gross/Net/Paid)": "40822" } }, branches: {} }, s).open).toBe(true);
    }
  });

  it("a truck sent from the drying yard straight to production has no Bin, so its GRN doesn't wait for one — every other truck's does", () => {
    // Every phase the GRN waits for, filled in — except the Bin.
    const stageData: Record<string, Record<string, string>> = {};
    for (const phase of [PHASES.ARRIVAL, PHASES.WEIGHT, PHASES.UNLOADING, PHASES.QUALITY_FINAL]) {
      for (const [stageId, label] of phase.required) (stageData[stageId] ??= {})[label] = "1";
    }
    const ALL_BUT_BIN = { stageData, branches: { "n-qfs": "pass" } };
    const allButBin = stageGate(ALL_BUT_BIN, "n-grn");
    expect(allButBin.waitingFor).toBe("Bin");
    expect(stageGate(ALL_BUT_BIN, "n-grn", { straightToProduction: true }).open).toBe(true);
  });

  it("a truck's own drying — straight onto the drying yard — opens once it has passed quality and is unloaded, before any Bin or GRN", () => {
    expect(stageGate({ stageData: {}, branches: {} }, "n-drying").open).toBe(false);
    const unloaded = {
      "n-gate": { "DATE OF ARRIVAL": "2026-11-20", "CREDIT/CASH": "CASH", "WH LOCATION": "BOUAKE", "VEHICLE NO.": "AB-1" },
      "n-verify": { "SUPPLIERS NAME": "S", "LBA CODE": "L", "FICHE CODE": "F", FICHE: "1", ORIGIN: "O" },
      "n-gross": { "GROSS WT KGS": "40000" },
      "n-unload": { "DATE OF OFFLOADING": "2026-11-20", "SACS (bags)": "600", "BON SACS (good bags)": "600", "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "0", Refraction: "0", "Tally Clerk bag count": "600" },
    };
    expect(stageGate({ stageData: unloaded, branches: {} }, "n-drying").waitingFor).toBe("Quality");
    expect(stageGate({ stageData: unloaded, branches: { "n-qfs": "pass" } }, "n-drying").open).toBe(true);
  });
});

describe("drop-downs, auto-fill and suggestions from the image", () => {
  it("Credit/Cash, RM/FG, basis for allocation and 'driven by' are picked from a list", () => {
    expect(fieldChoices("n-gate", "CREDIT/CASH")).toEqual(["CREDIT", "CASH"]);
    expect(fieldChoices("n-gate", "RM/FG")).toEqual(["RM", "FG"]);
    expect(fieldChoices("n-bin", "Basis for allocation (moisture / quality / KOR / space)")).toContain("Space");
    expect(fieldChoices("n-xferdec", "Driven by (space at warehouse)")).toContain("Space at warehouse");
  });

  it("the week fills itself from the arrival date the way the 2026 sheet writes it", () => {
    expect(weekLabel("2026-02-16")).toBe("W-8 Feb");
    expect(weekLabel("2026-03-02")).toBe("W-10 Mar");
    expect(weekLabel("")).toBe("");
    expect(autoFill("n-gate", { "VEHICLE NO.": "1KT" }, undefined, { today: "2026-11-16", arrivalDate: "2026-02-16" }).WEEK).toBe("W-8 Feb");
  });

  it("the Bin's linked Lot fills itself from the truck's Lot", () => {
    expect(autoFill("n-bin", { "Bin Number": "BKE-002-BIN-003" }, undefined, { today: "2026-11-16", arrivalDate: "2026-11-14", lot: "LOT-BKE-2026-001" }))
      .toEqual({ "Linked Lot Number(s)": "LOT-BKE-2026-001" });
  });

  it("pallets are suggested as bags ÷ 30, rounded up", () => {
    expect(prefillSuggestions({ "n-unload": { "SACS (bags)": "478" } }, "n-unload")["Pallets used (30 bags/pallet)"]).toEqual({ value: "16", from: "bags ÷ 30" });
  });
});
