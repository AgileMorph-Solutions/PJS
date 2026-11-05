import { describe, it, expect } from "vitest";
import { openingBalanceProblems } from "../src/domain/juteOpeningBalance.js";

describe("an opening balance", () => {
  it("can be zero, since a warehouse can genuinely start with no bags, and needs no remarks", () => {
    expect(openingBalanceProblems({ bags: "0", date: "2026-11-05" })).toEqual([]);
    expect(openingBalanceProblems({ bags: "5 000", date: "2026-11-05" })).toEqual([]);
  });

  it("needs a real count and a real date", () => {
    expect(openingBalanceProblems({})).toHaveLength(2);
    expect(openingBalanceProblems({ bags: "5,000", date: "2026-11-05" })).toEqual(["Opening stock must be a whole number of bags."]);
    expect(openingBalanceProblems({ bags: "-1", date: "2026-11-05" })).toEqual(["Opening stock must be a whole number of bags."]);
    expect(openingBalanceProblems({ bags: "1", date: "2026-02-31" })).toEqual(["Enter the date this count was taken."]);
  });
});
