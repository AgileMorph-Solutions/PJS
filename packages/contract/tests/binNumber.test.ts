import { describe, it, expect } from "vitest";
import { splitBinNumber, binNumberProblems, binsAtSite } from "../src/domain/binNumber.js";

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

describe("each site picks only its own bins (20 Nov 2026)", () => {
  const warehouses = [
    { name: "BOUAKE", kind: "REGIONAL_CENTRAL", type: "UNIT", site: null },
    { name: "BKE-002", kind: null, site: "BOUAKE" },
    { name: "YAKRO FACTORY", kind: "FACTORY", type: "CENTRAL", site: null },
  ];
  const bins = [
    { code: "BKE-002-BIN-012", store: "BKE-002" }, { code: "BKE-001-BIN-016", store: "BOUAKE" },
    { code: "BIN-001", store: "YAKRO FACTORY" }, { code: "BIN-04", store: null },
  ];

  it("Bouaké sees its site's and stores' bins, Yakro only its own, from a store or the site alike", () => {
    expect(binsAtSite(bins, warehouses, [], "BOUAKE")).toEqual(["BKE-001-BIN-016", "BKE-002-BIN-012"]);
    expect(binsAtSite(bins, warehouses, [], "BKE-002")).toEqual(["BKE-001-BIN-016", "BKE-002-BIN-012"]);
    expect(binsAtSite(bins, warehouses, [], "YAKRO FACTORY")).toEqual(["BIN-001"]);
  });

  it("offers a bin with no warehouse to nobody, and resolves an alias to its site", () => {
    for (const w of ["BOUAKE", "YAKRO FACTORY"]) expect(binsAtSite(bins, warehouses, [], w)).not.toContain("BIN-04");
    expect(binsAtSite(bins, warehouses, [{ alias: "ANAGROCI-01", warehouseName: "YAKRO FACTORY" }], "ANAGROCI-01")).toEqual(["BIN-001"]);
  });
});
