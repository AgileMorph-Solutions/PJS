/**
 * Production Phase 1, steps 1–2 (RCN Receipt, Moisture check): one load arriving on the production floor
 * from one bin of a batch, with its BTM slip, then checked for moisture. Source: the client's
 * "Phase 1 — Batch & Intake" document (Oct 2026). Weighing (steps 3–4) is in rcnWeighing.ts.
 */

/**
 * The doc's receipt statuses, moisture check then weighing; Intake done once the final weight is saved. Phase 2
 * (calibration.ts) carries it on: sized into the silos in one or more runs, then Calibrated.
 */
export type RcnReceiptStatus =
  | "waiting_for_moisture" | "moisture_pending" | "on_hold" | "waiting_for_weighing" | "weighing" | "intake_done"
  | "calibrating" | "calibrated";

export const RCN_RECEIPT_STATUS_LABELS: Record<RcnReceiptStatus, string> = {
  waiting_for_moisture: "Waiting for moisture",
  moisture_pending: "Moisture · waiting for approval",
  on_hold: "On hold",
  waiting_for_weighing: "Waiting for weighing",
  weighing: "Weighing in progress",
  intake_done: "Intake done",
  calibrating: "Calibration in progress",
  calibrated: "Calibrated",
};

/** "OK → after approval, Waiting for weighing; Hold → On hold; weighing stays locked until re-checked." */
export type MoistureDecision = "ok" | "hold";

export const MOISTURE_DECISION_LABELS: Record<MoistureDecision, string> = { ok: "OK", hold: "Fail · hold for re-check" };

/** A submitted check waits for the Incharge; an Incharge's or Admin's own entry is approved as it is saved. */
export type MoistureCheckStatus = "submitted" | "approved" | "rejected";

/**
 * Derived from the receipt's checks, never stored. A check waiting for approval wins (the doc: "Saved as
 * PENDING — receipt does NOT change yet", so the screen says who is next); otherwise the newest approved
 * check decides; a rejected one changes nothing. Past moisture, the weighing decides: a pallet weighed
 * means Weighing in progress, a saved final weight means Intake done. Past Intake, the calibration runs decide:
 * some kg sized means Calibration in progress, all of the into-silo kg sized means Calibrated.
 */
export function rcnReceiptStatus(
  checks: { status: MoistureCheckStatus; decision: MoistureDecision }[],
  weighing: { pallets: number; finalised: boolean; calibration?: { sizedKg: number; leftKg: number | null } } = { pallets: 0, finalised: false },
): RcnReceiptStatus {
  if (checks.some((c) => c.status === "submitted")) return "moisture_pending";
  const approved = checks.filter((c) => c.status === "approved").at(-1); // checks are oldest first
  if (!approved) return "waiting_for_moisture";
  if (approved.decision !== "ok") return "on_hold";
  if (weighing.finalised) {
    const c = weighing.calibration;
    if (!c || c.sizedKg <= 0) return "intake_done";
    return c.leftKg !== null && c.leftKg <= 0 ? "calibrated" : "calibrating";
  }
  return weighing.pallets > 0 ? "weighing" : "waiting_for_weighing";
}

/**
 * A load's steps can be recorded in any order (team decision, Nov 2026: the floor fills in what it has, when it has it;
 * nothing waits for an earlier form). The one limit on a moisture check is approval: while one waits for the Incharge,
 * a second would race it.
 */
export const canTakeMoistureCheck = (status: RcnReceiptStatus): boolean => status !== "moisture_pending";

/** Phase 2: a load is sized into the silos once its Intake is done, run by run, until all of it is. */
export const canCalibrate = (status: RcnReceiptStatus): boolean => status === "intake_done" || status === "calibrating";

/** Intake is over for the load: weighed and closed, whatever Phase 2 has done with it since. */
export const isIntakeDone = (status: RcnReceiptStatus): boolean => status === "intake_done" || canCalibrate(status) || status === "calibrated";

/** The cut-test parts, as in the client's "2. Input RCN Quality report" columns. */
export const CUT_TEST_GRAMS = [
  ["gkG", "Good kernel"],
  ["spotG", "Spotted"],
  ["immatureG", "Immature"],
  ["oilG", "Oil"],
  ["rejectionG", "Rejection"],
  ["voidsG", "Voids"],
  ["shellG", "Shell"],
  ["fruitWasteG", "Fruit waste"],
] as const;

export type CutTestGram = (typeof CUT_TEST_GRAMS)[number][0];

/** The doc: "cuts 1 kg of nuts open"; the client's sheet has 1000 on every row. */
export const DEFAULT_SAMPLE_G = "1000";

type GramValues = Partial<Record<CutTestGram | "sampleG", string>>;

const num = (v: string | undefined): number | null => {
  const t = (v ?? "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * The production quality sheet's own factor: its KOR column is `SUM(GK, Immature×0.5, Spot×0.5)*(80*2.2046/1000)`
 * on all 113 rows. Procurement's sheets use the rounded 0.17637 (receiptMath.KOR_FACTOR); each side keeps
 * its own sheet's number, so production's KOR matches the client's file to the last decimal.
 */
export const PRODUCTION_KOR_FACTOR = (80 * 2.2046) / 1000;

/**
 * KOR from the cut test. Null until good kernel, spotted and immature are all there: the cut test is
 * optional, and KOR is never typed. Real check: BTM 1001 (GK 230, spot 12, immature 13) → 42.76924.
 */
export function moistureKor(v: GramValues): number | null {
  const [gk, spot, imm] = [num(v.gkG), num(v.spotG), num(v.immatureG)];
  if (gk === null || spot === null || imm === null || [gk, spot, imm].some(Number.isNaN)) return null;
  return (gk + 0.5 * (spot + imm)) * PRODUCTION_KOR_FACTOR;
}

export interface MoistureFormValues extends GramValues {
  moisture?: string;
  nutCount?: string;
  decision?: string;
}

/** The doc's form checks; the first problem found, or null. Values are kept exactly as typed. */
export function moistureCheckError(v: MoistureFormValues): string | null {
  const moisture = num(v.moisture);
  if (moisture === null) return "Enter the moisture %.";
  if (Number.isNaN(moisture) || moisture < 0 || moisture > 20) return "Moisture must be a number between 0 and 20.";
  const nutCount = num(v.nutCount);
  if (nutCount === null) return "Enter the nut count.";
  if (Number.isNaN(nutCount) || nutCount <= 0) return "Nut count must be a number above 0.";
  for (const [key, label] of CUT_TEST_GRAMS) {
    const g = num(v[key]);
    if (g !== null && (Number.isNaN(g) || g < 0)) return `${label} must be a number of grams, 0 or more.`;
  }
  const sample = num(v.sampleG);
  const gramsTotal = CUT_TEST_GRAMS.reduce((n, [key]) => n + (num(v[key]) ?? 0), 0);
  if (gramsTotal > 0) {
    if (sample === null || Number.isNaN(sample) || sample <= 0) return "Enter the sample weight the grams were cut from.";
    if (gramsTotal > sample) return `The grams add up to ${gramsTotal} g, more than the ${sample} g sample.`;
  }
  if (v.decision !== "ok" && v.decision !== "hold") return "Choose OK or Fail.";
  return null;
}

const sameBtm = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/**
 * The receipts already recorded with this BTM from this bin. The doc makes this a warning, not a refusal:
 * the client's own file has real repeats (BTM 120 has two rows from BIN-03B), so a second one can be genuine.
 */
export function sameBtmAndBin<T extends { btmNo: string; binCode: string }>(existing: T[], btmNo: string, binCode: string): T[] {
  return existing.filter((r) => r.binCode === binCode && sameBtm(r.btmNo, btmNo));
}

/**
 * The stages one RCN receipt (one load) walks through on the production floor, as the client's sheets record them:
 * "1. RCN Receipts" (the load and its BTM slip), "2. Input RCN Quality report" (moisture and cut test), "19. RCN
 * Receipts Tally Sheet" (each pallet on the scale, then empty pallets, dust and voids), "4. Calibration Process
 * report" (sized into the silos). One stage, one form — the receipt page shows them as separate steps, like a truck's.
 */
export type RcnStageId = "receipt" | "moisture" | "pallets" | "final_weight" | "calibration";

/** done · current (the next job) · waiting (done here, waiting for the Incharge's approval) · todo (not reached yet). */
export type RcnStageState = "done" | "current" | "waiting" | "todo";

export const RCN_STAGES: { id: RcnStageId; label: string; hint: string }[] = [
  { id: "receipt", label: "RCN receipt", hint: "The load and the BTM slip that came with it." },
  { id: "moisture", label: "Moisture check", hint: "Sample moisture, nut count and cut test. OK lets the load be weighed." },
  { id: "pallets", label: "Pallet weighing", hint: "Each pallet on the scale: gross weight and bags." },
  { id: "final_weight", label: "Final weight", hint: "Empty pallets, dust and voids, to close the weighing." },
  { id: "calibration", label: "Calibration", hint: "How many kg of the load went into each size silo." },
];

/**
 * Each step of a load stands on its own — steps are recorded in any order — so each is done by what it holds: an OK
 * moisture check approved, a pallet weighed, the final weight saved, all of the load sorted into the silos. A check
 * waiting for approval is "waiting". The first step not done yet is "current": what to do next, not a lock.
 */
export function rcnReceiptStages(r: {
  status: RcnReceiptStatus;
  moistureChecks: { status: MoistureCheckStatus; decision: MoistureDecision }[];
  pallets: unknown[];
  finalWeight: unknown | null;
  calibration: { sizedKg: number; leftKg: number | null } | null;
}): Record<RcnStageId, RcnStageState> {
  const approved = r.moistureChecks.filter((c) => c.status === "approved").at(-1);
  const done: Record<RcnStageId, boolean> = {
    receipt: true,
    moisture: approved?.decision === "ok",
    pallets: r.pallets.length > 0,
    final_weight: Boolean(r.finalWeight),
    calibration: Boolean(r.calibration && r.calibration.sizedKg > 0 && r.calibration.leftKg !== null && r.calibration.leftKg <= 0),
  };
  const waiting = r.moistureChecks.some((c) => c.status === "submitted");
  const states = Object.fromEntries(RCN_STAGES.map((s) => [s.id, done[s.id] ? "done" : s.id === "moisture" && waiting ? "waiting" : "todo"])) as Record<RcnStageId, RcnStageState>;
  const next = RCN_STAGES.find((s) => states[s.id] === "todo");
  if (next) states[next.id] = "current";
  return states;
}

/** The stage to open first: the next job, or the one waiting for approval, or the last one once all are done. */
export function openStage(stages: Record<RcnStageId, RcnStageState>): RcnStageId {
  return RCN_STAGES.find((s) => stages[s.id] === "current" || stages[s.id] === "waiting")?.id ?? "calibration";
}
