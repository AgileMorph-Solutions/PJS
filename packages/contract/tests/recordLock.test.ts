import { describe, it, expect } from "vitest";
import { isGrnComplete, LOCKED_STAGES, LOCKED_DECISIONS } from "../src/domain/recordLock";
import { autoDateFill, isAutoDateField } from "../src/data/autoFields";
import { MODULE_STAGES, MODULE_STATUSES, moduleOfStage, RECEPTION_STAGES, OFFLOADING_STAGES } from "../src/data/modules";
import { ALL_STATUSES } from "../src/domain/receiptStatus";
import { STAGE_FIELD_MAP } from "../src/generated/stageFieldMap";
import { GRN_QUANTITY_LABEL } from "../src/domain/receiptStatus";

describe("when a record is complete enough to lock", () => {
  it("needs both the GRN quantity and the price, in either order", () => {
    expect(isGrnComplete({})).toBe(false);
    expect(isGrnComplete({ "n-grn": { [GRN_QUANTITY_LABEL]: "30000" } })).toBe(false);
    expect(isGrnComplete({ "n-grn": { PRICE: "470" } })).toBe(false);
    expect(isGrnComplete({ "n-grn": { PRICE: "470", [GRN_QUANTITY_LABEL]: "30000" } })).toBe(true);
    expect(isGrnComplete({ "n-grn": { PRICE: "470", [GRN_QUANTITY_LABEL]: "  " } })).toBe(false);
  });

  it("closes the reception record from the gate to the GRN, and leaves the steps after the GRN open", () => {
    for (const s of ["n-gate", "n-verify", "n-gross", "n-qfs", "n-unload", "n-netwt", "n-lot", "n-bin", "n-grn"]) expect(LOCKED_STAGES.has(s), s).toBe(true);
    for (const s of ["n-stock", "n-drying", "n-otheract", "n-ledger", "n-xferdec"]) expect(LOCKED_STAGES.has(s), s).toBe(false);
    expect([...LOCKED_DECISIONS]).toEqual(["n-qfs"]); // drying and transfer decisions happen after the GRN
  });
});

describe("the two receiving modules", () => {
  it("name only stages that exist, and never the same stage twice", () => {
    const ids = new Set(Object.keys(STAGE_FIELD_MAP));
    const all = [...RECEPTION_STAGES, ...OFFLOADING_STAGES];
    for (const s of all) expect(ids.has(s), `${s} is not a stage`).toBe(true);
    expect(new Set(all).size).toBe(all.length);
    expect(MODULE_STAGES.reception).toBe(RECEPTION_STAGES);
    expect(moduleOfStage("n-qfs")).toBe("reception");
    expect(moduleOfStage("n-grn")).toBe("offloading");
    expect(moduleOfStage("n-drying")).toBeNull();
  });
});

describe("which truck is in which module", () => {
  it("every status belongs to exactly one module, so no truck is in both lists or in neither", () => {
    const all = [...MODULE_STATUSES.reception, ...MODULE_STATUSES.offloading];
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...ALL_STATUSES].sort());
  });
});

describe("dates that fill themselves", () => {
  const ctx = { today: "2026-10-16", arrivalDate: "2026-10-14" };

  it("fills a blank arrival date from the receipt's own arrival date, and a blank offloading date with today", () => {
    expect(autoDateFill("n-gate", { "VEHICLE NO.": "1KT" }, undefined, ctx)).toEqual({ "DATE OF ARRIVAL": "2026-10-14" });
    expect(autoDateFill("n-unload", { "BON SACS (good bags)": "100" }, {}, ctx)).toEqual({ "DATE OF OFFLOADING": "2026-10-16" });
  });

  it("never overrides what the person gave, what is already stored, or a deliberate clear", () => {
    expect(autoDateFill("n-gate", { "DATE OF ARRIVAL": "2026-09-01" }, undefined, ctx)).toEqual({});
    expect(autoDateFill("n-gate", { "VEHICLE NO.": "1KT" }, { "DATE OF ARRIVAL": "2026-09-01" }, ctx)).toEqual({});
    expect(autoDateFill("n-gate", { "DATE OF ARRIVAL": "" }, undefined, ctx)).toEqual({});
  });

  it("touches nothing on a stage that has no auto date", () => {
    expect(autoDateFill("n-qfs", { KOR: "47" }, undefined, ctx)).toEqual({});
    expect(isAutoDateField("n-gate", "DATE OF ARRIVAL")).toBe(true);
    expect(isAutoDateField("n-gate", "VEHICLE NO.")).toBe(false);
  });
});
