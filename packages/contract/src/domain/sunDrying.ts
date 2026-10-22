/**
 * Sun drying, as the client asked for it (Oct 2026): a Lot is dried in rounds. Each round is issued (weight and quality
 * before), comes back (weight after), and is quality-checked (moisture, nut count and a cut test after). The check either
 * passes the Lot or sends it back for another round, starting from what came back. The QFS reception sample stays its own,
 * separate measurement: drying never overwrites it and its "before" figures are measured again, not copied from it.
 *
 * One round is one DryingBatch row; later rounds point at the first (`firstBatchId`) and carry `round` 2, 3 …
 */
import { korFromGrams } from "./receiptMath.js";

export const DRYING_STATUS = {
  inDrying: "IN DRYING",
  qualityCheck: "QUALITY CHECK",
  passed: "PASSED",
  redry: "RE-DRY",
} as const;

export type DryingPhase = "in_drying" | "quality_check" | "passed" | "redry" | "other";

/**
 * Where a round is. "IN PROGRESS" and "COMPLETED" are the two statuses in-app drying used before rounds existed; the imported
 * workbook rows keep whatever free text their sheet had ("other"), shown as it is.
 */
export function dryingPhase(status: string | null | undefined): DryingPhase {
  const s = (status ?? "").trim().toUpperCase();
  if (s === DRYING_STATUS.inDrying || s === "IN PROGRESS") return "in_drying";
  if (s === DRYING_STATUS.qualityCheck) return "quality_check";
  if (s === DRYING_STATUS.passed || s === "COMPLETED") return "passed";
  if (s === DRYING_STATUS.redry) return "redry";
  return "other";
}

export const DRYING_PHASE_LABELS: Record<DryingPhase, string> = {
  in_drying: "In drying",
  quality_check: "Awaiting quality check",
  passed: "Passed",
  redry: "Sent for re-drying",
  other: "Recorded",
};

/** A round that is still open: the Lot is on the yard, or back and waiting for its quality check. */
export const isOpenRound = (status: string | null | undefined) => {
  const p = dryingPhase(status);
  return p === "in_drying" || p === "quality_check";
};

/** The quality measured before or after a round. Grams are from a cut test of the drying sample. */
export interface DryingQuality {
  moisture: number | null;
  nutCount: number | null;
  goodKernelG: number | null;
  immatureG: number | null;
  spottedG: number | null;
  rejectionG: number | null;
  voidG: number | null;
  oilG: number | null;
  shellG: number | null;
  /** Typed KOR; ignored when the three grams KOR is calculated from are all there. */
  kor: number | null;
}

/** KOR for a drying check: calculated from the grams when they are all recorded (as at QFS), otherwise the typed value. */
export function dryingKor(q: Pick<DryingQuality, "goodKernelG" | "immatureG" | "spottedG" | "kor">): number | null {
  if (q.goodKernelG !== null && q.immatureG !== null && q.spottedG !== null) {
    return Math.round(korFromGrams(q.goodKernelG, q.immatureG, q.spottedG) * 100) / 100;
  }
  return q.kor;
}

/** Why a quality reading can't be right, or null. Moisture is required: it is what drying is for. */
export function dryingQualityProblem(q: DryingQuality, when: "before" | "after"): string | null {
  if (q.moisture === null) return `Moisture ${when} drying is required.`;
  if (q.moisture < 0 || q.moisture > 100) return `Moisture ${when} drying must be between 0 and 100 %.`;
  const grams = [q.goodKernelG, q.immatureG, q.spottedG, q.rejectionG, q.voidG, q.oilG, q.shellG].filter((g): g is number => g !== null);
  if (grams.some((g) => g < 0)) return `Cut-test grams ${when} drying can't be negative.`;
  if (grams.reduce((a, b) => a + b, 0) > 1000) return `Cut-test grams ${when} drying add up to more than the 1000 g sample.`;
  const kor = dryingKor(q);
  if (kor !== null && (kor < 0 || kor > 80)) return `KOR ${when} drying must be between 0 and 80.`;
  return null;
}
