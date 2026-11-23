import { describe, it, expect } from "vitest";
import { stages, rejectStage } from "../src/data/stages.js";
import { RECEPTION_STAGES, OFFLOADING_STAGES, WAREHOUSE_ACTIVITY_STAGES } from "../src/data/modules.js";
import { receptionStages, warehouseActivityStages, legacyLotStages } from "../src/domain/warehouseActivityStages.js";

describe("which stages are the reception record", () => {
  it("every stage is on exactly one side, so none can drop off both", () => {
    const ids = [...receptionStages, ...warehouseActivityStages].map((s) => s.id).sort();
    expect(ids).toEqual(stages.map((s) => s.id).sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every stage belongs to exactly one part: reception, offloading or warehouse activities", () => {
    const parts = [...RECEPTION_STAGES, ...OFFLOADING_STAGES, ...WAREHOUSE_ACTIVITY_STAGES];
    expect(new Set(parts).size).toBe(parts.length);
    expect([...parts].sort()).toEqual([...stages, rejectStage].map((s) => s.id).sort());
  });

  it("reception ends with the stock update", () => {
    expect(receptionStages.at(-1)?.id).toBe("n-stock");
  });
});

describe("what a truck recorded per Lot before warehouse activities moved to Bins", () => {
  const r = (over: Partial<Parameters<typeof legacyLotStages>[0]> = {}) => ({ stageData: {}, branches: {}, ...over });

  it("is shown when it exists, so nothing recorded goes out of reach", () => {
    expect(legacyLotStages(r({ stageData: { "n-otheract": { Destacking: "12" } } })).map((s) => s.id)).toEqual(["n-otheract"]);
    expect(legacyLotStages(r({ branches: { "n-xferdec": "stays" } })).map((s) => s.id)).toEqual(["n-xferdec"]);
  });

  it("is nothing on a truck that never recorded any", () => {
    expect(legacyLotStages(r())).toEqual([]);
  });

  it("leaves out drying: a truck's own drying (straight onto the yard) is still recorded on the truck", () => {
    expect(legacyLotStages(r({ stageData: { "n-drying": {} } }))).toEqual([]);
  });
});
