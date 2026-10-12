import { describe, it, expect } from "vitest";
import { checkUploadRow, type UploadCheckInput } from "../src/domain/uploadChecks";

const clean = (over: Partial<UploadCheckInput> = {}): UploadCheckInput => ({
  arrivalDate: "2026-09-02", supplierName: "SCOOP AKISSI", lbaCode: "LBA-101-AKI", today: "2026-10-12",
  stageData: { "n-gross": { "Loaded truck weight (kg)": "38000" }, "n-tare": { "Tare / empty truck weight (kg)": "6800" }, "n-qfs": { "MOIS. (moisture)": "10,5", KOR: "47.2" } },
  suppliers: new Map([["LBA-101-AKI", "SCOOP AKISSI"]]), ficheUsedBy: [], ...over,
});
const messages = (i: UploadCheckInput) => checkUploadRow(i).map((w) => w.message);

describe("upload row checks", () => {
  it("a clean row, with a French decimal comma, has no warnings", () => {
    expect(checkUploadRow(clean())).toEqual([]);
  });

  it("flags a value that is not a number or is negative, naming the column", () => {
    const w = checkUploadRow(clean({ stageData: { "n-qfs": { "MOIS. (moisture)": "ten", KOR: "-3" } } }));
    expect(w).toEqual(expect.arrayContaining([
      expect.objectContaining({ column: "MOIS. (moisture)", message: expect.stringContaining("isn't a number") }),
      expect.objectContaining({ column: "KOR", message: expect.stringContaining("negative") }),
    ]));
  });

  it("flags moisture over 100 and KOR over 80, and an empty truck heavier than the loaded one", () => {
    const m = messages(clean({ stageData: { "n-qfs": { "MOIS. (moisture)": "140", KOR: "95" }, "n-gross": { "Loaded truck weight (kg)": "5000" }, "n-tare": { "Tare / empty truck weight (kg)": "6000" } } }));
    expect(m.some((x) => /over 100%/.test(x))).toBe(true);
    expect(m.some((x) => /over 80/.test(x))).toBe(true);
    expect(m.some((x) => /empty truck/.test(x))).toBe(true);
  });

  it("flags offloading before arrival and an arrival in the future", () => {
    expect(messages(clean({ stageData: { "n-unload": { "DATE OF OFFLOADING": "2026-08-30" } } })).some((x) => /before the truck arrived/.test(x))).toBe(true);
    expect(messages(clean({ arrivalDate: "2027-01-01" })).some((x) => /in the future/.test(x))).toBe(true);
  });

  it("flags an LBA code missing from the master, or a name that differs, but not a blank code", () => {
    expect(messages(clean({ lbaCode: "LBA-999-XXX" }))).toEqual(["LBA-999-XXX isn't in the supplier master"]);
    expect(messages(clean({ supplierName: "SCOOP OTHER" }))[0]).toMatch(/differs from "SCOOP AKISSI"/);
    expect(checkUploadRow(clean({ lbaCode: "", supplierName: "" }))).toEqual([]);
  });

  it("treats a name still written with the old RCN prefix as the same supplier", () => {
    expect(checkUploadRow(clean({ supplierName: "RCN SCOOP AKISSI" }))).toEqual([]);
  });

  it("flags a fiche already used by another truck", () => {
    const w = checkUploadRow(clean({ ficheUsedBy: ["REC-BKE-2026-0003"], stageData: { "n-verify": { FICHE: "88101" } } }));
    expect(w[0]).toMatchObject({ column: "FICHE", severity: "warning" });
    expect(w[0]!.message).toContain("REC-BKE-2026-0003");
  });

  it("never compares Net, GRN and Paid — they legitimately differ", () => {
    expect(checkUploadRow(clean({ stageData: { "n-grn": { "GRN Weight (kept separate from Gross/Net/Paid)": "20000" }, "n-netwt": { "NET WT KGS": "31000", "PAID WT": "30000" } } }))).toEqual([]);
  });
});
