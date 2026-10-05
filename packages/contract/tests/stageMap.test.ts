/**
 * Invariants of the shared dictionary. These run without a database, so they're the fast guard —
 * the backend's roundTrip/stageMap.schema tests then prove the same dictionary matches the real
 * schema.
 */
import { describe, it, expect } from "vitest";
import { stages, rejectStage } from "../src/data/stages.js";
import { juteLedgers } from "../src/data/juteBags.js";
import { STAGE_FIELD_MAP, LEDGER_COLUMN_MAP, colFor } from "../src/generated/stageFieldMap.js";
import { deriveStatus, getStageProgress, isStageBlank } from "../src/domain/receiptStatus.js";
import { DECISION_BRANCHES } from "../src/domain/decisions.js";

const allStages = [...stages, rejectStage];

describe("stage dictionary", () => {
  it("covers all 16 stage records and 72 fields", () => {
    expect(allStages.length).toBe(16);
    // 69 + REMARKS/WEEK on n-gate — real "Truck Reception" columns that were fingerprinted but
    // never actually captured until now (see truckReception.ts's parser and stages.ts's n-gate) —
    // + n-gross's loaded truck weight, the reading Gross is now calculated from.
    expect(allStages.reduce((n, s) => n + s.fields.length, 0)).toBe(72);
    expect(Object.keys(STAGE_FIELD_MAP).length).toBe(16);
  });

  it("gives every field a column name that Postgres can actually hold", () => {
    // Identifiers over 63 bytes are silently truncated, which would collide two fields into one.
    for (const s of allStages) {
      for (const f of s.fields) {
        expect(f.col, `${s.id}/${f.n}`).toBeTruthy();
        expect(Buffer.byteLength(f.col), `${s.id}.${f.col}`).toBeLessThanOrEqual(63);
      }
    }
  });

  it("keeps column names unique within a stage", () => {
    for (const s of allStages) {
      const cols = s.fields.map((f) => f.col);
      expect(new Set(cols).size, s.id).toBe(cols.length);
    }
  });

  it("keys on (stageId, label), because one label is reused across two stages", () => {
    const reused = "Warehouse type (Village/Regional/Factory)";
    const owners = allStages.filter((s) => s.fields.some((f) => f.n === reused)).map((s) => s.id);
    expect(owners).toEqual(["n-gate", "n-stock"]);
    // Same label, resolved independently per stage — that's the whole point of the composite key.
    expect(colFor("n-gate", reused)).toBe("warehouseType");
    expect(colFor("n-stock", reused)).toBe("warehouseType");
  });

  it("preserves the client's labels verbatim, accents and misspellings included", () => {
    expect(colFor("n-unload", "Sacs déchirés (torn bags)")).toBe("sacsDechires");
    expect(colFor("n-drying", "Moisture % — before drying")).toBe("moistureBefore");
    expect(colFor("n-drying", 'New/assigned Bin (marked "dried stock")')).toBe("driedStockBin");
    // The misspelling is the client's own column heading — it belongs in the UI, not the schema.
    const l4 = LEDGER_COLUMN_MAP["warehouse-to-warehouse-movement"];
    expect(l4.columns.find((c) => c.label === "Diffrence in Bag at Receiving")?.col).toBe("reportedDifference");
  });

  it("refuses an unknown label rather than silently no-opping a write", () => {
    expect(() => colFor("n-gate", "NOT A REAL COLUMN")).toThrow(/Unknown field/);
    expect(() => colFor("n-nope", "x")).toThrow(/Unknown stage/);
  });
});

describe("ledger dictionary", () => {
  it("covers all four ledgers and every column", () => {
    expect(Object.keys(LEDGER_COLUMN_MAP).length).toBe(4);
    for (const l of juteLedgers) {
      const spec = LEDGER_COLUMN_MAP[l.id];
      expect(spec.columns.length, l.id).toBe(l.columns.length);
      for (const c of spec.columns) expect(Buffer.byteLength(c.col)).toBeLessThanOrEqual(63);
    }
  });
});

describe("deriveStatus", () => {
  it("treats a stage as reached on PRESENCE, not on having any filled value", () => {
    // Load-bearing: the form writes a stage key the moment a field is touched, so an all-blank
    // stage is a real state. The backend's StageEntry reproduces this deliberately.
    expect(deriveStatus({ stageData: { "n-drying": {} }, branches: {} })).toBe("in_drying");
    expect(deriveStatus({ stageData: { "n-gate": { "S N": "" } }, branches: {} })).toBe("arrived");
  });

  it("puts the terminal branches ahead of stage progress", () => {
    const far = { "n-gate": {}, "n-unload": {}, "n-grn": {}, "n-stock": {} };
    expect(deriveStatus({ stageData: far, branches: { "n-qfs": "fail" } })).toBe("rejected");
    expect(deriveStatus({ stageData: far, branches: { "n-xferdec": "transfer" } })).toBe("transferred_out");
  });

  it("only knows branch ids that decisions.ts declares", () => {
    for (const [stageId, outcomes] of Object.entries(DECISION_BRANCHES)) {
      expect(STAGE_FIELD_MAP[stageId], stageId).toBeTruthy();
      expect(outcomes.length).toBeGreaterThan(0);
    }
  });
});

describe("getStageProgress", () => {
  it("treats a stage as reached on PRESENCE, matching deriveStatus's rule", () => {
    const p = getStageProgress({ stageData: { "n-gate": {} }, branches: {} });
    expect(p.doneIds.has("n-gate")).toBe(true);
    expect(p.doneCount).toBe(1);
  });

  it("counts a decision stage done only once a branch is actually chosen, not on stageData presence", () => {
    const withFieldsOnly = getStageProgress({ stageData: { "n-qfs": { MOIS: "10" } }, branches: {} });
    expect(withFieldsOnly.doneIds.has("n-qfs")).toBe(false);
    const withBranch = getStageProgress({ stageData: {}, branches: { "n-qfs": "pass" } });
    expect(withBranch.doneIds.has("n-qfs")).toBe(true);
  });

  it("anchors activeStage on the FURTHEST reached stage, not an earlier untouched gap (n-lot)", () => {
    // n-lot ("Assign Lot Number") is an early gap stage left blank on nearly every imported
    // receipt — activeStage must not regress to it just because it was never filled in.
    const p = getStageProgress({ stageData: { "n-unload": {} }, branches: {} });
    expect(p.activeStage?.id).not.toBe("n-lot");
  });

  it("activeStage is undefined once every stage is reached", () => {
    const allData = Object.fromEntries(stages.map((s) => [s.id, {}]));
    const allBranches = Object.fromEntries(stages.filter((s) => s.kind === "decision").map((s) => [s.id, "x"]));
    const p = getStageProgress({ stageData: allData, branches: allBranches });
    expect(p.activeStage).toBeUndefined();
    expect(p.doneCount).toBe(p.totalCount);
  });
});

describe("isStageBlank", () => {
  it("is true for a reached stage with no field values at all", () => {
    expect(isStageBlank({})).toBe(true);
  });

  it("is true when every value is blank or whitespace", () => {
    expect(isStageBlank({ "S N": "", Notes: "   " })).toBe(true);
  });

  it("is false once any field has real content", () => {
    expect(isStageBlank({ "S N": "", "NET WT KGS": "1200" })).toBe(false);
  });

  it("is false for a stage that hasn't been reached at all", () => {
    expect(isStageBlank(undefined)).toBe(false);
  });
});
