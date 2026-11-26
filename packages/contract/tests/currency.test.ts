import { describe, it, expect } from "vitest";
import { CURRENCY, formatAmount, formatMoney, isMoneyField } from "../src/domain/currency";
import { stages } from "../src/data/stages";

// 26 Nov 2026 (user): the currency is CFA, written before the number.
describe("money", () => {
  it("is written CFA first, with thousands separators", () => {
    expect(CURRENCY).toBe("CFA");
    expect(formatMoney("19158140")).toBe("CFA 19,158,140");
    expect(formatMoney(470)).toBe("CFA 470");
    expect(formatMoney("470.5")).toBe("CFA 470.5");
  });
  it("writes the figure as on a bill in a box that already shows CFA, and leaves text that isn't a number alone", () => {
    expect(formatAmount("19158140")).toBe("19,158,140");
    expect(formatAmount("470.256")).toBe("470.26");
    expect(formatAmount("")).toBe("");
    expect(formatAmount("47O")).toBe("47O");
  });
  it("shows nothing for a blank or a value that isn't a number, never CFA 0", () => {
    expect(formatMoney("")).toBe("");
    expect(formatMoney(undefined)).toBe("");
    expect(formatMoney("abc")).toBe("");
  });
  it("marks the GRN's price and amount as money, and their labels say CFA", () => {
    expect(isMoneyField("n-grn", "PRICE")).toBe(true);
    expect(isMoneyField("n-grn", "AMOUNT")).toBe(true);
    expect(isMoneyField("n-grn", "GRN Weight (kept separate from Gross/Net/Paid)")).toBe(false);
    const grn = stages.find((s) => s.id === "n-grn")!.fields;
    for (const f of grn.filter((f) => isMoneyField("n-grn", f.n))) expect(f.label).toContain("CFA");
    expect(JSON.stringify(stages)).not.toMatch(/XOF per kg|\(XOF\)/);
  });
});
