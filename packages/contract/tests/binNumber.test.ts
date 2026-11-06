import { describe, it, expect } from "vitest";
import { splitBinNumber, binNumberProblems } from "../src/domain/binNumber.js";

const bins = ["BKE-002-BIN-004", "BKE-002-BIN-006"];
const stores = ["BKE-002"];

describe("Bin Number", () => {
  it("splits the real workbook's two-bin entry, on / or ,", () => {
    expect(splitBinNumber("BKE-002-BIN-004 / BKE-002-BIN-006")).toEqual(bins);
    expect(splitBinNumber("BKE-002-BIN-004,BKE-002-BIN-006")).toEqual(bins);
    expect(splitBinNumber("  ")).toEqual([]);
    expect(splitBinNumber(null)).toEqual([]);
  });

  it("accepts complete bins from the master, alone or together", () => {
    expect(binNumberProblems("BKE-002-BIN-004", bins, stores)).toEqual([]);
    expect(binNumberProblems("BKE-002-BIN-004 / BKE-002-BIN-006", bins, stores)).toEqual([]);
    expect(binNumberProblems("", bins, stores)).toEqual([]);
  });

  // The bug this guards: every keystroke was saved, so "B", "BK", ... reached the server, was refused,
  // and the page reloaded the empty saved value over what was being typed.
  it("flags a half-typed code, so it is held on screen instead of being sent", () => {
    expect(binNumberProblems("B", bins, stores)).toEqual([{ code: "B", reason: "unknown" }]);
    expect(binNumberProblems("BKE-002-BIN-004 / BKE", bins, stores)).toEqual([{ code: "BKE", reason: "unknown" }]);
  });

  it("flags a store code separately — it is a real place, just not a Bin", () => {
    expect(binNumberProblems("BKE-002", bins, stores)).toEqual([{ code: "BKE-002", reason: "store" }]);
  });

  it("matches exactly, like the server — a lower-case spelling is not silently accepted", () => {
    expect(binNumberProblems("bke-002-bin-004", bins, stores)).toEqual([{ code: "bke-002-bin-004", reason: "unknown" }]);
  });
});
