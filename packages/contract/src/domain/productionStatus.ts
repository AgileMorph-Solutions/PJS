import type { ProductionTable } from "../types/production.js";
import { productionTables, productionTableById } from "../data/productionTables.js";
import { productionStageById } from "../data/productionStages.js";

/**
 * Two derived statuses, not one — deriveStatus() (receiptStatus.ts) stays untouched, it's
 * procurement's. Production has two spines (see packages/contract/CLAUDE.md's Production section):
 * a BtmIntake runs Phase 1-2 (receive → quality-check → calibrate), then hands off at Cooking to a
 * ProductionLot that runs Phase 3-8. Each spine gets its own presence ladder, same shape as
 * deriveStatus(): terminal branches checked first, then a hand-ordered furthest-first walk over
 * TABLE presence (not flow-node presence — several flow nodes share one physical table, e.g.
 * n-shell/o-kern/o-uncut/k-wholes/k-pieces/k-rej/k-black all point at "shelling-run", so node-level
 * presence can't distinguish them; table-level presence is the real persisted granularity).
 *
 * Tradeoff worth stating: "received" and "weighed" (Phase 1's two steps) share one table
 * (btm-receipt, both n-recv and n-weigh write into the same 11-column row), so they collapse into
 * one status here rather than being separately derivable from presence alone — same limitation
 * deriveStatus() would have if two procurement stages shared a table.
 */

export type BtmStatus = "planned" | "received" | "quality_checked" | "reconciled" | "calibrated" | "quality_hold";

export type LotStatus = "cooking" | "shelled" | "in_borma" | "peeling" | "packed" | "dispatched";

/** table id -> whether ANY row exists for this BTM/Lot. Presence, not content — same rule as
 * deriveStatus's `stageData["n-drying"]` check: a table counts as reached the moment a row exists,
 * even with every field blank. */
export type TablePresence = Record<string, boolean>;

export interface BtmStatusInputs {
  branches: Record<string, string>;
  tables: TablePresence;
}

export function deriveBtmStatus(r: BtmStatusInputs): BtmStatus {
  if (r.branches["n-qc1"] === "fail") return "quality_hold";
  if (r.tables["calibration-run"]) return "calibrated";
  if (r.tables["btm-tally-row"]) return "reconciled";
  if (r.tables["btm-input-quality"]) return "quality_checked";
  if (r.tables["btm-receipt"]) return "received";
  return "planned";
}

export interface LotStatusInputs {
  branches: Record<string, string>;
  tables: TablePresence;
  /** Content check, deliberately: like deriveStatus's branches["n-qfs"] === "fail", "has this lot's
   * packed quantity actually been dispatched" cannot be read from table presence alone, because
   * Qty Packed and Quantity Dispatched live in the same packing-record row — the row exists the
   * moment ANYTHING is packed, before anything ships. */
  anyDispatched?: boolean;
}

export function deriveLotStatus(r: LotStatusInputs): LotStatus {
  if (r.anyDispatched) return "dispatched";
  if (r.tables["packing-record"]) return "packed";
  if (r.branches["n-qc8"] === "peeling" && r.tables["peeling-performance"]) return "peeling";
  if (r.tables["borma-run"]) return "in_borma";
  if (r.tables["shelling-run"]) return "shelled";
  return "cooking"; // a ProductionLot cannot exist before cooking-run — see architecture note
}

export const BTM_STATUS_LABELS: Record<BtmStatus, string> = {
  planned: "Planned",
  received: "Received",
  quality_checked: "Quality checked",
  reconciled: "Reconciled",
  calibrated: "Calibrated",
  quality_hold: "Quality hold",
};

export const LOT_STATUS_LABELS: Record<LotStatus, string> = {
  cooking: "Cooking",
  shelled: "Shelled",
  in_borma: "In Borma",
  peeling: "Peeling",
  packed: "Packed",
  dispatched: "Dispatched",
};

export const ALL_BTM_STATUSES: BtmStatus[] = ["planned", "received", "quality_checked", "reconciled", "calibrated", "quality_hold"];
export const ALL_LOT_STATUSES: LotStatus[] = ["cooking", "shelled", "in_borma", "peeling", "packed", "dispatched"];

/** Which tables hang off which spine, keyed for the ladders above and for a UI progress bar. */
export const BTM_SPINE_TABLES: string[] = productionTables.filter((t: ProductionTable) => t.spine === "btm").map((t) => t.id);
export const LOT_SPINE_TABLES: string[] = productionTables.filter((t: ProductionTable) => t.spine === "lot").map((t) => t.id);
export const BIN_SPINE_TABLES: string[] = productionTables.filter((t: ProductionTable) => t.spine === "bin").map((t) => t.id);
export const STANDALONE_TABLES: string[] = productionTables.filter((t: ProductionTable) => t.spine === "standalone").map((t) => t.id);

/**
 * One human label per table, for the stage-tracker UI (and anywhere else a table id needs a
 * display name) — a single source so the frontend doesn't hand-maintain its own copy per page.
 */
export const PRODUCTION_TABLE_LABELS: Record<string, string> = {
  "btm-receipt": "Receipt lines",
  "btm-input-quality": "Input quality checks",
  "btm-tally-row": "Receipts tally",
  "calibration-run": "Calibration",
  "silos-stock-row": "Calibrated RCN silo stock",
  "wholes-manual-calibration": "Wholes manual calibration",
  "cooking-run": "Cooking",
  "shelling-run": "Shelling",
  "shelling-machine-sample": "Shelling machine samples",
  "shelling-frequency-sample": "Shelling frequency samples",
  "shelling-line-run": "Shelling line runs",
  "shell-waste-sample": "Shell waste samples",
  "kernel-quality-sample": "Kernel quality samples",
  "borma-run": "Borma",
  "borma-trolley-row": "Borma trolley log",
  "borma-machine-cycle": "Borma machine cycles",
  "final-output-sample": "Final output samples",
  "peeling-performance": "Peeling performance",
  "packing-record": "Packing",
  "waste-dispatch": "Waste dispatch",
  "shell-dispatch": "Shell dispatch",
  "boiler-consumption": "Boiler consumption",
  "offloading-bin-report": "Offloading BIN report",
  "wip-stock-report": "WIP stock report",
};

/** The phase label a table's first flow node was transcribed under — same "one node's worth of
 * provenance stands in for the table" convention productionTables.ts's own sourceNodeIds already
 * establish. */
export function phaseForTable(tableId: string): string {
  const table = productionTableById[tableId];
  const nodeId = table?.sourceNodeIds[0];
  return (nodeId && productionStageById[nodeId]?.phase) || "";
}

/**
 * The production twin of getStageProgress() (receiptStatus.ts), for a single BTM/Lot record — a
 * table counts as "done" purely on TablePresence, exactly like deriveBtmStatus/deriveLotStatus
 * already read it (presence, not content). activeTableId is the same "furthest done, plus one"
 * rule getStageProgress uses, not a first-gap scan — ordered off BTM_SPINE_TABLES/LOT_SPINE_TABLES
 * so it can never drift from the tables those status ladders themselves read.
 */
export interface ProductionStageStep {
  tableId: string;
  label: string;
  phase: string;
  done: boolean;
}

export interface ProductionStageProgress {
  steps: ProductionStageStep[];
  doneCount: number;
  totalCount: number;
  activeTableId?: string;
}

function tableProgress(tableIds: string[], tables: TablePresence): ProductionStageProgress {
  const steps = tableIds.map((tableId) => ({
    tableId,
    label: PRODUCTION_TABLE_LABELS[tableId] ?? tableId,
    phase: phaseForTable(tableId),
    done: Boolean(tables[tableId]),
  }));
  let lastDoneIndex = -1;
  steps.forEach((s, i) => { if (s.done) lastDoneIndex = i; });
  return {
    steps,
    doneCount: steps.filter((s) => s.done).length,
    totalCount: steps.length,
    activeTableId: steps[lastDoneIndex + 1]?.tableId,
  };
}

export function getBtmTableProgress(tables: TablePresence): ProductionStageProgress {
  return tableProgress(BTM_SPINE_TABLES, tables);
}

export function getLotTableProgress(tables: TablePresence): ProductionStageProgress {
  return tableProgress(LOT_SPINE_TABLES, tables);
}
