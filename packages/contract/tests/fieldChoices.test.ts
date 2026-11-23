import { describe, it, expect } from "vitest";
import { resolveChoice } from "../src/data/fieldChoices";

describe("resolveChoice", () => {
  it("gives the list's own spelling for an answer typed in another case or with spaces", () => {
    expect(resolveChoice("n-gate", "CREDIT/CASH", "cash")?.value).toBe("CASH");
    expect(resolveChoice("n-gate", "CREDIT/CASH", "  Credit ")?.value).toBe("CREDIT");
  });

  it("finds no answer for a typo, and says what the answers are", () => {
    expect(resolveChoice("n-gate", "CREDIT/CASH", "cach")).toEqual({ options: ["CREDIT", "CASH"], value: undefined });
  });

  it("says nothing for a field that has no list", () => {
    expect(resolveChoice("n-gate", "VEHICLE NO.", "anything")).toBeUndefined();
    expect(resolveChoice("n-nope", "CREDIT/CASH", "CASH")).toBeUndefined();
  });
});
