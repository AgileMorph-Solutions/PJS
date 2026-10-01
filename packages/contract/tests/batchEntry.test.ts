import { describe, it, expect } from "vitest";
import { BATCH_TRUCK_COLUMNS, BATCH_REQUIRED_LABEL } from "../src/data/batchEntry.js";
import { STAGE_FIELD_MAP } from "../src/generated/stageFieldMap.js";

describe("batch truck entry columns", () => {
  it("only reference stage labels that still exist in the field dictionary", () => {
    for (const { stageId, label } of BATCH_TRUCK_COLUMNS) {
      expect(
        STAGE_FIELD_MAP[stageId].fields.some((f) => f.label === label),
        `${stageId} has no field "${label}"`
      ).toBe(true);
    }
  });

  it("includes the field that makes a row a truck", () => {
    expect(BATCH_TRUCK_COLUMNS.some((c) => c.label === BATCH_REQUIRED_LABEL)).toBe(true);
  });

  it("has no duplicate columns", () => {
    const keys = BATCH_TRUCK_COLUMNS.map((c) => `${c.stageId}/${c.label}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
