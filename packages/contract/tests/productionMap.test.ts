/**
 * Invariants of the production dictionary — the production twin of stageMap.test.ts. These run
 * without a database; the backend's productionRoundTrip test then proves the same dictionary
 * matches the real schema.
 */
import { describe, it, expect } from "vitest";
import { productionStages, productionStageById } from "../src/data/productionStages.js";
import { productionTables, productionTableById } from "../src/data/productionTables.js";
import { PRODUCTION_FIELD_MAP, productionColFor } from "../src/generated/productionFieldMap.js";
import { PRODUCTION_DECISION_BRANCHES } from "../src/domain/productionDecisions.js";
import {
  deriveBtmStatus, deriveLotStatus, ALL_BTM_STATUSES, ALL_LOT_STATUSES,
  BTM_SPINE_TABLES, LOT_SPINE_TABLES, BIN_SPINE_TABLES, STANDALONE_TABLES,
  getBtmTableProgress, getLotTableProgress, PRODUCTION_TABLE_LABELS,
} from "../src/domain/productionStatus.js";

describe("production flow map", () => {
  it("covers all 80 flow nodes across the phases + utilities lane", () => {
    expect(productionStages.length).toBe(80);
    expect(Object.keys(productionStageById).length).toBe(80);
  });

  it("every node has a non-empty id, title, phase and kind", () => {
    // note is NOT asserted non-empty: 21 real flow nodes genuinely have no note in the source map
    // (mostly output-breakdown siblings like o-kern/k-wholes that share a table with a node that
    // DOES carry the note) — leaving it blank is the verbatim transcription, not a gap to fill in.
    for (const s of productionStages) {
      expect(s.id, "id").toBeTruthy();
      expect(s.title, `${s.id}.title`).toBeTruthy();
      expect(s.phase, `${s.id}.phase`).toBeTruthy();
      expect(["entry", "decision", "system", "gap", "utility", "byproduct"]).toContain(s.kind);
    }
  });

  it("reclassifies the four packing nodes as entry/real, backed by the real workbook", () => {
    for (const id of ["w-pack", "w-fg", "p-pack", "p-fg"]) {
      const s = productionStageById[id];
      expect(s.kind, id).toBe("entry");
      expect(s.file, id).toBe("Packing Traceability  FG Aging Report.xlsx");
      expect(s.fields.length, id).toBeGreaterThan(0);
    }
  });
});

describe("production storage tables", () => {
  it("collapses 80 flow nodes into 24 distinct storage tables", () => {
    expect(productionTables.length).toBe(24);
    expect(Object.keys(PRODUCTION_FIELD_MAP).length).toBe(24);
  });

  it("gives every field a column name Postgres can hold, unique per table", () => {
    for (const t of productionTables) {
      const cols = new Set<string>();
      for (const f of t.fields) {
        expect(f.col, `${t.id}/${f.n}`).toBeTruthy();
        expect(Buffer.byteLength(f.col), `${t.id}.${f.col}`).toBeLessThanOrEqual(63);
        expect(cols.has(f.col), `${t.id} reuses col ${f.col}`).toBe(false);
        cols.add(f.col);
      }
    }
  });

  it("every table traces to at least one real flow node, and every sourceNodeId exists", () => {
    for (const t of productionTables) {
      expect(t.sourceNodeIds.length, t.id).toBeGreaterThan(0);
      for (const nid of t.sourceNodeIds) {
        expect(productionStageById[nid], `${t.id} -> ${nid}`).toBeDefined();
      }
    }
  });

  it("colFor throws on an unknown table or label", () => {
    expect(() => productionColFor("not-a-table", "x")).toThrow();
    expect(() => productionColFor("btm-receipt", "not-a-label")).toThrow();
    expect(productionColFor("btm-receipt", "BTM No")).toBe("btmNo");
  });

  it("assigns every table to exactly one spine, and the spine partition covers all 24", () => {
    const total = BTM_SPINE_TABLES.length + LOT_SPINE_TABLES.length + BIN_SPINE_TABLES.length + STANDALONE_TABLES.length;
    expect(total).toBe(24);
    for (const id of BTM_SPINE_TABLES) expect(productionTableById[id].spine).toBe("btm");
    for (const id of LOT_SPINE_TABLES) expect(productionTableById[id].spine).toBe("lot");
    for (const id of BIN_SPINE_TABLES) expect(productionTableById[id].spine).toBe("bin");
    for (const id of STANDALONE_TABLES) expect(productionTableById[id].spine).toBe("standalone");
  });

  it("the pivot table (silos-stock-row) is on the Bin spine, not BTM or Lot", () => {
    expect(productionTableById["silos-stock-row"].spine).toBe("bin");
  });

  it("borma-trolley-row includes the real routing column (correction: was 17 fields from a pivot excerpt, now 18 from the full sheet)", () => {
    const fields = productionTableById["borma-trolley-row"].fields;
    expect(fields.length).toBe(18);
    expect(fields.some((f) => f.col === "to")).toBe(true);
  });

  it("the two later-pass tables (offloading-bin-report, wip-stock-report) trace to their own flow nodes, not any of the original 78", () => {
    expect(productionTableById["offloading-bin-report"].sourceNodeIds).toEqual(["n-offload-bin"]);
    expect(productionTableById["wip-stock-report"].sourceNodeIds).toEqual(["n-wip-tally"]);
    expect(productionStageById["n-offload-bin"].kind).toBe("entry");
    expect(productionStageById["n-wip-tally"].kind).toBe("entry");
  });
});

describe("production decisions", () => {
  it("every PRODUCTION_DECISION_BRANCHES key is a real decision node", () => {
    for (const stageId of Object.keys(PRODUCTION_DECISION_BRANCHES)) {
      expect(productionStageById[stageId], stageId).toBeDefined();
      expect(productionStageById[stageId].kind, stageId).toBe("decision");
    }
  });

  it("n-qc8's branch options are the real Borma routing data (Packing/Peeling)", () => {
    const branches = PRODUCTION_DECISION_BRANCHES["n-qc8"];
    expect(branches.map((b) => b.id).sort()).toEqual(["packing", "peeling"]);
  });
});

describe("deriveBtmStatus / deriveLotStatus — presence, not content", () => {
  it("an empty BTM is planned", () => {
    expect(deriveBtmStatus({ branches: {}, tables: {} })).toBe("planned");
  });

  it("a table counts as reached on presence alone, even with no known field content", () => {
    expect(deriveBtmStatus({ branches: {}, tables: { "btm-receipt": true } })).toBe("received");
    expect(deriveBtmStatus({ branches: {}, tables: { "calibration-run": true, "btm-receipt": true } })).toBe("calibrated");
  });

  it("a failed n-qc1 branch beats table presence", () => {
    expect(deriveBtmStatus({ branches: { "n-qc1": "fail" }, tables: { "calibration-run": true } })).toBe("quality_hold");
  });

  it("a lot cannot exist before cooking-run, by construction", () => {
    expect(deriveLotStatus({ branches: {}, tables: {} })).toBe("cooking");
  });

  it("furthest-reached table wins, walking backwards from packed", () => {
    expect(deriveLotStatus({ branches: {}, tables: { "shelling-run": true, "borma-run": true } })).toBe("in_borma");
    expect(deriveLotStatus({ branches: {}, tables: { "packing-record": true, "borma-run": true } })).toBe("packed");
  });

  it("dispatched is a content check, deliberately, layered over table presence", () => {
    expect(deriveLotStatus({ branches: {}, tables: { "packing-record": true }, anyDispatched: true })).toBe("dispatched");
  });

  it("every status enum value is reachable from ALL_*_STATUSES", () => {
    expect(ALL_BTM_STATUSES).toContain("calibrated");
    expect(ALL_LOT_STATUSES).toContain("dispatched");
  });
});

describe("getBtmTableProgress / getLotTableProgress — the production twin of getStageProgress", () => {
  it("every table has a label", () => {
    for (const id of BTM_SPINE_TABLES.concat(LOT_SPINE_TABLES)) {
      expect(PRODUCTION_TABLE_LABELS[id], id).toBeTruthy();
    }
  });

  it("an empty BTM has zero done, no active table picked wrong", () => {
    const p = getBtmTableProgress({});
    expect(p.doneCount).toBe(0);
    expect(p.totalCount).toBe(BTM_SPINE_TABLES.length);
    expect(p.activeTableId).toBe(BTM_SPINE_TABLES[0]);
  });

  it("activeTableId is the furthest-done-plus-one, not first-undone", () => {
    // btm-tally-row done but btm-input-quality (earlier in the list) is not — activeTableId must
    // still land right after btm-tally-row, mirroring getStageProgress's own "furthest, not first
    // gap" rule exactly.
    const tables = { "btm-receipt": true, "btm-tally-row": true };
    const p = getBtmTableProgress(tables);
    const tallyIndex = BTM_SPINE_TABLES.indexOf("btm-tally-row");
    expect(p.activeTableId).toBe(BTM_SPINE_TABLES[tallyIndex + 1]);
  });

  it("all done leaves no active table, same as getStageProgress when every stage is reached", () => {
    const tables = Object.fromEntries(LOT_SPINE_TABLES.map((id) => [id, true]));
    const p = getLotTableProgress(tables);
    expect(p.doneCount).toBe(p.totalCount);
    expect(p.activeTableId).toBeUndefined();
  });
});

describe("getBtmTableProgress / getLotTableProgress — the production twin of getStageProgress", () => {
  it("every table has a label", () => {
    for (const id of BTM_SPINE_TABLES.concat(LOT_SPINE_TABLES)) {
      expect(PRODUCTION_TABLE_LABELS[id], id).toBeTruthy();
    }
  });

  it("an empty BTM has zero done, no active table picked wrong", () => {
    const p = getBtmTableProgress({});
    expect(p.doneCount).toBe(0);
    expect(p.totalCount).toBe(BTM_SPINE_TABLES.length);
    expect(p.activeTableId).toBe(BTM_SPINE_TABLES[0]);
  });

  it("activeTableId is the furthest-done-plus-one, not first-undone", () => {
    // btm-tally-row done but btm-input-quality (earlier in the list) is not — activeTableId must
    // still land right after btm-tally-row, mirroring getStageProgress's own "furthest, not first
    // gap" rule exactly.
    const tables = { "btm-receipt": true, "btm-tally-row": true };
    const p = getBtmTableProgress(tables);
    const tallyIndex = BTM_SPINE_TABLES.indexOf("btm-tally-row");
    expect(p.activeTableId).toBe(BTM_SPINE_TABLES[tallyIndex + 1]);
  });

  it("all done leaves no active table, same as getStageProgress when every stage is reached", () => {
    const tables = Object.fromEntries(LOT_SPINE_TABLES.map((id) => [id, true]));
    const p = getLotTableProgress(tables);
    expect(p.doneCount).toBe(p.totalCount);
    expect(p.activeTableId).toBeUndefined();
  });
});
