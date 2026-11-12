import type { SamplingPoint, SiloCheck, SiloDay, SiloSize, SiloStock, SizeValues, SizingDecision, SizingGrams } from "../domain/calibration.js";
import type { MoistureCheckStatus } from "../domain/rcnReceipt.js";

/** One run of a load through the sizing machine (Phase 2, step 2). Kg kept as typed; totals are calculated. */
export interface CalibrationRun {
  id: number;
  date: string;
  sizes: SizeValues;
  totalKg: number;
  createdBy: string | null;
  createdAt: string;
}

/** A load's calibration: its into-silo kg from Intake, what its runs have sized so far, and what is left. */
export interface RcnCalibration {
  /** Null until the final weight is saved: steps are recorded in any order, and only the final weight says the total. */
  toSilosKg: number | null;
  sizedKg: number;
  /** Null while toSilosKg is. */
  leftKg: number | null;
  /** Oldest first. */
  runs: CalibrationRun[];
}

/** Kg moved by hand from one silo to another after a failed QC-2 (Phase 2, step 4). */
export interface ManualCalibration {
  id: number;
  sizingCheckId: number;
  date: string;
  fromSize: SiloSize;
  toSize: SiloSize;
  kg: string;
  createdBy: string | null;
  createdAt: string;
}

/** One QC-2 sample (Phase 2, step 3): submitted by the QFS Officer, approved by the Warehouse Incharge. */
export interface SizingCheck {
  id: number;
  batchCode: string;
  /** The batch's warehouse bin the nuts came from, as the sheet's "BIN NO"; blank when not given. */
  binCode: string;
  date: string;
  point: SamplingPoint;
  nutCount: string;
  sampleG: string;
  grams: SizingGrams;
  /** Calculated (domain/calibration.correctSizePct); null for a received-RCN sample. */
  correctPct: number | null;
  /** The alerts the doc lists (parts ≠ sample, below 85 %). */
  notes: string[];
  decision: SizingDecision;
  status: MoistureCheckStatus;
  submittedBy: string | null;
  submittedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  /** The silo moves made because of this check. */
  manualCalibrations: ManualCalibration[];
}

/** Phase 2 for a batch: the factory's silos and the batch's sizing checks. */
export interface BatchCalibration {
  /** The factory's silos, per size: they hold every batch's sized nuts, not only this one's. */
  silos: SiloStock[];
  /** This batch's own sized-in kg, per size. */
  batchSizedKg: Record<SiloSize, number>;
  /** Where each silo stands on QC-2. The silos are shared, so every batch's checks count here. */
  siloChecks: Record<SiloSize, SiloCheck>;
  /**
   * This batch's checks, newest first, plus any other batch's failed check a shared silo still stands on: that
   * silo needs fixing from whichever batch page is open.
   */
  sizingChecks: SizingCheck[];
  /** The factory's silos day by day, oldest first: "5. Calibrated RCN Silos Stock report". */
  daily: SiloDay[];
}

export interface CalibrationRunInput {
  date?: string;
  sizes?: SizeValues;
}

export interface SizingCheckInput {
  batchCode?: string;
  binCode?: string;
  date?: string;
  point?: string;
  nutCount?: string;
  sampleG?: string;
  grams?: SizingGrams;
  decision?: string;
}

export interface ManualCalibrationInput {
  date?: string;
  fromSize?: string;
  toSize?: string;
  kg?: string;
}
