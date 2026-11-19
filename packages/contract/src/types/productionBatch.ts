import type { BatchStatus, LotInBin } from "../domain/productionBatch.js";

/** A factory warehouse bin offered on the New batch screen. */
export interface AvailableBin {
  binCode: string;
  /**
   * The warehouse the Bin is in: where its Lots are (their trucks' warehouse, or the BKT's receiving one), else the Bin master.
   * Many imported Bin masters have no warehouse, so the Lots are the better witness. null when neither says.
   */
  store: string | null;
  /** The Lots in the bin, each tracing back to its truck (or the BKT that brought it): the trucks to open when the bin adds no kg. */
  lots: LotInBin[];
  /** Current stock (kg), worked out from the procurement Lots in it. */
  kg: number;
  lotCount: number;
  /** Lots in the bin that add no kg: no GRN weight recorded, or split across bins without a share. */
  lotsWithoutKg: number;
  /** Lots physically in the bin but marked "Keep in warehouse", so not in its stock. A batch still takes the whole bin. */
  lotsKept: number;
  /** Set when the bin is already in a running batch — it can't be picked again. */
  inBatch: string | null;
  /** False when the code appears on receipts but not in Masters › Bins, so it can't be put in a batch. */
  inMaster: boolean;
}

export interface BatchBinView {
  binCode: string;
  /** The bin's stock when the batch was created: the plan, kept as it was. */
  plannedKg: number;
  /** What is in the bin now: procurement's stock less what production accepted out of it (issuedKg). */
  currentKg: number;
  /** The net kg of the loads from this bin production has accepted, already taken off currentKg. */
  issuedKg: number;
  lots: LotInBin[];
}

export interface BatchSummary {
  /** The run's system ID, PR-<warehouse code>-<year>-NNN — always issued by the system, like a truck's REC- ID. */
  code: string;
  /** An optional name the team gave it (ANA-03B), shown beside the ID. */
  name: string | null;
  warehouse: string;
  startDate: string;
  proposedBy: string | null;
  createdBy: string | null;
  createdAt: string;
  status: BatchStatus;
  plannedKg: number;
  days: number;
  endDate: string | null;
  binCodes: string[];
}

export interface BatchHistoryEntry {
  at: string;
  text: string;
  actor: string | null;
}

export interface BatchDetail extends BatchSummary {
  bins: BatchBinView[];
  history: BatchHistoryEntry[];
}
