import { describe, it, expect } from "vitest";
import { stages } from "../src/data/stages.js";
import { computeDerivedFields } from "../src/domain/receiptMath.js";
import { missingStageFields } from "../src/domain/receiptStatus.js";

const stage = (id: string) => stages.find((s) => s.id === id)!;
const missing = (id: string, data: Record<string, Record<string, string>>, branch?: string) =>
  missingStageFields(id, stage(id).fields, data[id], computeDerivedFields(data)[id], branch);

// A step is ticked only once every field on it is filled (Nov 2026), not as soon as one value lands in it.
describe("missingStageFields: what keeps a step's tick away", () => {
  it("Arrival with WH NO. empty is not complete; REMARKS and S N never hold it back", () => {
    const gate = {
      "DATE OF ARRIVAL": "2026-11-25", "RM/FG": "RM", "CREDIT/CASH": "CASH", "WH LOCATION": "BOUAKE", "VEHICLE NO.": "827KT01",
      "Warehouse type (Village/Regional/Factory)": "Regional Central", WEEK: "W-48 Nov", "Laisse-Passer Entree (Yakro)": "153",
    };
    expect(missing("n-gate", { "n-gate": gate })).toEqual(["WH NO."]);
    expect(missing("n-gate", { "n-gate": { ...gate, "WH NO.": "BKE-001" } })).toEqual([]);
  });

  it("supplier documents are complete without REF., an optional field", () => {
    const verify = { "SUPPLIERS NAME": "S", "LBA CODE": "LBA-001", "FICHE CODE": "0401-0007", FICHE: "72515", ORIGIN: "Bouaké" };
    expect(missing("n-verify", { "n-verify": verify })).toEqual([]);
    expect(missing("n-verify", { "n-verify": { ...verify, ORIGIN: "" } })).toEqual(["ORIGIN"]);
  });

  it("Weight with only the loaded truck weight is not complete; Gross counts once the two weights calculate it", () => {
    expect(missing("n-gross", { "n-gross": { "Loaded truck weight (kg)": "50000" } }))
      .toEqual(["Tare / empty truck weight (kg)", "GROSS WT KGS"]);
    expect(missing("n-gross", { "n-gross": { "Loaded truck weight (kg)": "50000", "Tare / empty truck weight (kg)": "15000" } })).toEqual([]);
  });

  it("a truck failed at quality is never unloaded, so its final readings are never asked for", () => {
    const sampleOnly = Object.fromEntries(stage("n-qfs").fields.filter((f) => !/^final\b/i.test(f.n)).map((f) => [f.n, "1"]));
    expect(missing("n-qfs", { "n-qfs": sampleOnly }, "fail")).toEqual([]);
    expect(missing("n-qfs", { "n-qfs": sampleOnly }, "pass")).toContain("Final unloading moisture (%)");
  });

  it("only the fields given count: a field this person isn't shown is never named as missing", () => {
    expect(missingStageFields("n-grn", stage("n-grn").fields.filter((f) => f.n !== "PRICE" && f.n !== "AMOUNT"), { "GRN Weight (kept separate from Gross/Net/Paid)": "40762" })).toEqual([]);
  });
});
