import type { CutTestGram, MoistureCheckStatus, MoistureDecision, RcnReceiptStatus } from "../domain/rcnReceipt.js";

/** One moisture check of a load (Phase 1, step 2). Numbers are kept as typed; KOR is calculated. */
export interface MoistureCheck {
  id: number;
  moisture: string;
  nutCount: string;
  /** Sample weight the grams were cut from; blank when no cut test was done. */
  sampleG: string;
  grams: Partial<Record<CutTestGram, string>>;
  /** From the grams (domain/rcnReceipt.moistureKor); null without a cut test. */
  kor: number | null;
  decision: MoistureDecision;
  status: MoistureCheckStatus;
  submittedBy: string | null;
  submittedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
}

/** One pallet of a load on the scale (Phase 1, step 3). Its number is its place in the load, not stored. */
export interface RcnPallet {
  id: number;
  no: number;
  grossKg: string;
  bags: string;
  factoryBin: string;
  weighedBy: string | null;
  weighedAt: string;
}

/** The load's closing figures (Phase 1, step 4). Totals come from domain/rcnWeighing.weighingTotals. */
export interface RcnFinalWeight {
  emptyPallets: { weightKg: string; count: string }[];
  /** Blank when not recorded. */
  dustKg: string;
  voidsKg: string;
  finalisedBy: string | null;
  finalisedAt: string;
}

/** One load that arrived at production from one bin of a batch. */
export interface RcnReceipt {
  id: string;
  batchCode: string;
  /** ISO date the load arrived. */
  date: string;
  /** The number on the transfer slip that came with the load. */
  btmNo: string;
  /** The warehouse bin of the batch the load came from. */
  binCode: string;
  status: RcnReceiptStatus;
  /** Oldest first. */
  moistureChecks: MoistureCheck[];
  /** In the order weighed. */
  pallets: RcnPallet[];
  /** Null until the final weight is saved. */
  finalWeight: RcnFinalWeight | null;
  createdBy: string | null;
  createdAt: string;
}

export interface RcnPalletInput {
  grossKg?: string;
  bags?: string;
  factoryBin?: string;
}

export interface RcnFinalWeightInput {
  emptyPallets?: { weightKg?: string; count?: string }[];
  dustKg?: string;
  voidsKg?: string;
}

export interface RcnReceiptInput {
  batchCode?: string;
  date?: string;
  btmNo?: string;
  binCode?: string;
}

export interface MoistureCheckInput extends Partial<Record<CutTestGram, string>> {
  moisture?: string;
  nutCount?: string;
  sampleG?: string;
  decision?: string;
}
