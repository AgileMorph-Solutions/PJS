import { describe, it, expect } from "vitest";
import { emptyBagReceiptProblems } from "../src/domain/juteEmptyBagReceipt.js";

const GOOD = { fromWarehouse: "BOUAKE", date: "2026-03-09", truckNumber: "", warehouseReceiptNo: "", bagsReceived: "30850", responsibleParty: "J. Kouassi" };

describe("emptyBagReceiptProblems", () => {
  it("accepts a complete entry, with the truck and receipt number left out", () => {
    expect(emptyBagReceiptProblems(GOOD, "YAKRO FACTORY")).toEqual([]);
  });

  it("refuses bags coming from the warehouse receiving them", () => {
    expect(emptyBagReceiptProblems(GOOD, "BOUAKE")).toEqual(["The bags must come from a different warehouse."]);
  });

  it.each([
    [{ fromWarehouse: " " }, "came from"],
    [{ date: "2026-02-31" }, "date"],
    [{ bagsReceived: "0" }, "at least 1"],
    [{ bagsReceived: "1,000" }, "at least 1"],
    [{ responsibleParty: "" }, "responsible"],
  ])("refuses %j", (bad, word) => {
    const problems = emptyBagReceiptProblems({ ...GOOD, ...bad }, "YAKRO FACTORY");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(word);
  });
});
