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
  createdBy: string | null;
  createdAt: string;
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
