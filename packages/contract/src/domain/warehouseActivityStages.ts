/**
 * Which of a truck's stages are its reception record (gate entry to GRN and stock) and which were, until 22 Nov 2026, its
 * per-Lot warehouse activities (data/modules.ts's WAREHOUSE_ACTIVITY_STAGES). Since then warehouse activities are per Bin
 * (Sameer, 18 Nov 2026: "once the bin is created, lot is gone") and live on the Bin's page. A truck keeps only the drying
 * straight off the truck onto the drying yard, which happens while it is being unloaded. What a Lot already recorded on the
 * other three is kept and shown, never dropped.
 */
import type { ReceiptRecord } from "../types/receipt.js";
import type { Stage } from "../types/stage.js";
import { stages } from "../data/stages.js";
import { WAREHOUSE_ACTIVITY_STAGES } from "../data/modules.js";

const ACTIVITY_IDS: ReadonlySet<string> = new Set(WAREHOUSE_ACTIVITY_STAGES);

export const isWarehouseActivityStage = (stageId: string) => ACTIVITY_IDS.has(stageId);

/** The stages of the reception record, in order: gate entry to "Add this truck to warehouse stock". */
export const receptionStages: Stage[] = stages.filter((s) => !ACTIVITY_IDS.has(s.id));

/** The per-Lot warehouse stages, in order: drying, other activities, the activity ledger, transfer / production. */
export const warehouseActivityStages: Stage[] = stages.filter((s) => ACTIVITY_IDS.has(s.id));

/** The truck's own drying: straight off the truck onto the drying yard. */
export const YARD_DRYING_STAGE = "n-drying";

type Recorded = Pick<ReceiptRecord, "stageData" | "branches">;

/** A stage has something recorded on this truck: it exists, or its decision was made. */
export const stageRecorded = (r: Recorded, stageId: string) => r.stageData[stageId] !== undefined || r.branches[stageId] !== undefined;

/**
 * The per-Lot warehouse stages this truck recorded before they moved to Bins (other activities, the ledger, transfer /
 * production). Shown read-only on its record so nothing it holds goes out of reach; new work is recorded on the Bin.
 */
export const legacyLotStages = (r: Recorded): Stage[] =>
  warehouseActivityStages.filter((s) => s.id !== YARD_DRYING_STAGE && stageRecorded(r, s.id));

/**
 * The two ledgers a Bin keeps on its own Warehouse activities page (team, 23 Nov 2026): "Other warehouse activities" and
 * "Activity ledger (sequence of record)" — the same fields a truck's Lot had, independent of each other. Since warehouse
 * activities moved to Bins (22 Nov 2026) new entries are made here; what a truck recorded before stays on its record. Each
 * holds many entries (26 Nov 2026, user), not one form.
 */
export const BIN_STAGE_IDS = ["n-otheract", "n-ledger"] as const;
export type BinStageId = (typeof BIN_STAGE_IDS)[number];
export const isBinStage = (stageId: string): stageId is BinStageId => (BIN_STAGE_IDS as readonly string[]).includes(stageId);

/**
 * "Does this Bin need drying?" (25 Nov 2026): asked on the Bin's page, Yes or No, as a truck's drying was asked per Lot before.
 * Yes leads into sun drying from the Bin; No is kept, and can be changed to Yes. Stored beside the Bin's forms under its own
 * key, which isn't one of them (BIN_STAGE_IDS), so no form draws it.
 */
export type BinDryingAnswer = "yes" | "no";
export const BIN_DRYING_DECISION_KEY = "drying-decision";
export interface BinDryingDecision { answer: BinDryingAnswer; by: string | null; at: string }

/** One entry of a Bin's ledger as the page reads it: the values by label, and who entered and last changed it. */
export interface BinActivityEntryView {
  id: number;
  stageId: BinStageId;
  values: Record<string, string>;
  enteredBy: string | null;
  enteredAt: string;
  editedBy: string | null;
  editedAt: string;
}

