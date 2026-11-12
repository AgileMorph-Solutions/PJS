import { describe, it, expect } from "vitest";
import { isUsableSite, listSites, receiptStore, siteOf, siteSetupGaps, siteTypeOf, warehouseSlug } from "../src/domain/siteType";
import type { WarehouseMaster } from "../src/types/receipt";

// Sites are whatever the Warehouses master says — these use made-up names on purpose, so nothing here can
// quietly depend on a particular client site existing.
const W: WarehouseMaster[] = [
  { name: "NORTH HUB", kind: "REGIONAL_CENTRAL", type: "UNIT", code: "NHB", site: null },
  { name: "NH-001", kind: null, type: null, site: "NORTH HUB" },
  { name: "MAIN PLANT", kind: "FACTORY", type: "CENTRAL", code: "MPL", site: null },
  { name: "UNPLACED", kind: null, type: null, site: null },
  // Typed but never given an ID code — like BKE-04: nothing could be recorded there.
  { name: "HALF DONE", kind: "FACTORY", type: "UNIT", site: null },
];

describe("sites from the master", () => {
  it("lists only top-level rows with a type and an ID code, sorted — never a store", () => {
    expect(listSites(W).map((w) => w.name)).toEqual(["MAIN PLANT", "NORTH HUB"]);
    expect(listSites([])).toEqual([]);
  });

  it("says what an unfinished warehouse still needs", () => {
    expect(isUsableSite(W[4]!)).toBe(false);
    expect(siteSetupGaps(W[4]!)).toEqual(["an ID code"]);
    expect(siteSetupGaps(W[3]!)).toEqual(["a Unit/Central type", "an ID code"]);
    expect(siteSetupGaps(W[0]!)).toEqual([]);
    expect(siteSetupGaps(W[1]!)).toEqual([]); // a store is never a site to finish
  });

  it("slugs a name for the URL", () => {
    expect(warehouseSlug("MAIN PLANT")).toBe("main-plant");
    expect(warehouseSlug(" Bouaké  ")).toBe("bouake");
    expect(warehouseSlug("A/B__C")).toBe("a-b-c");
  });

  it("resolves a store or an alias to its site", () => {
    expect(siteOf(W, [], "NH-001")?.name).toBe("NORTH HUB");
    expect(siteOf(W, [{ alias: "PLANT-OLD", warehouseName: "MAIN PLANT" }], "PLANT-OLD")?.name).toBe("MAIN PLANT");
    expect(siteOf(W, [], "NOWHERE")).toBeUndefined();
    expect(siteTypeOf(W, [], "NH-001")).toBe("UNIT");
  });
});

describe("the store a truck is at (Reception is per store)", () => {
  const gate = (whNo: string) => ({ "n-gate": { "WH NO.": whNo } });
  const MP = [...W, { name: "MP-001", kind: null, type: null, site: "MAIN PLANT" }];

  it("is the receipt's own warehouse when that is a store — whatever the gate typed", () => {
    expect(receiptStore(MP, [], { warehouse: "NH-001", stageData: gate("MP-001") })).toBe("NH-001");
  });

  it("falls back to the gate's WH NO. for a receipt filed at the site", () => {
    expect(receiptStore(MP, [], { warehouse: "NORTH HUB", stageData: gate(" NH-001 ") })).toBe("NH-001");
  });

  it("follows an alias of the site", () => {
    expect(receiptStore(MP, [{ alias: "NHUB", warehouseName: "NORTH HUB" }], { warehouse: "NHUB", stageData: gate("NH-001") })).toBe("NH-001");
  });

  it("is no store when the gate names nothing, an unknown store, or another site's store — never a guess", () => {
    expect(receiptStore(MP, [], { warehouse: "NORTH HUB", stageData: gate("") })).toBeNull();
    expect(receiptStore(MP, [], { warehouse: "NORTH HUB", stageData: {} })).toBeNull();
    expect(receiptStore(MP, [], { warehouse: "NORTH HUB", stageData: gate("NH-999") })).toBeNull();
    expect(receiptStore(MP, [], { warehouse: "NORTH HUB", stageData: gate("MP-001") })).toBeNull();
    expect(receiptStore(MP, [], { warehouse: "NOT IN MASTER", stageData: gate("NH-001") })).toBeNull();
  });
});
