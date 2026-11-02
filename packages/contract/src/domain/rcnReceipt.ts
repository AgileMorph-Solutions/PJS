/**
 * Production Phase 1, steps 1–2 (RCN Receipt, Moisture check): one load arriving on the production floor
 * from one bin of a batch, with its BTM slip, then checked for moisture. Source: the client's
 * "Phase 1 — Batch & Intake" document (Oct 2026). Weighing (steps 3–4) is not built yet.
 */

/** The doc's receipt statuses up to the moisture check; weighing adds its own when it is built. */
export type RcnReceiptStatus = "waiting_for_moisture" | "moisture_pending" | "on_hold" | "waiting_for_weighing";

export const RCN_RECEIPT_STATUS_LABELS: Record<RcnReceiptStatus, string> = {
  waiting_for_moisture: "Waiting for moisture",
  moisture_pending: "Moisture · waiting for approval",
  on_hold: "On hold",
  waiting_for_weighing: "Waiting for weighing",
};

/** "OK → after approval, Waiting for weighing; Hold → On hold; weighing stays locked until re-checked." */
export type MoistureDecision = "ok" | "hold";

export const MOISTURE_DECISION_LABELS: Record<MoistureDecision, string> = { ok: "OK", hold: "Fail · hold for re-check" };

/** A submitted check waits for the Incharge; an Incharge's or Admin's own entry is approved as it is saved. */
export type MoistureCheckStatus = "submitted" | "approved" | "rejected";

/**
 * Derived from the receipt's checks, never stored. A check waiting for approval wins (the doc: "Saved as
 * PENDING — receipt does NOT change yet", so the screen says who is next); otherwise the newest approved
 * check decides; a rejected one changes nothing.
 */
export function rcnReceiptStatus(checks: { status: MoistureCheckStatus; decision: MoistureDecision }[]): RcnReceiptStatus {
  if (checks.some((c) => c.status === "submitted")) return "moisture_pending";
  const approved = checks.filter((c) => c.status === "approved").at(-1); // checks are oldest first
  if (!approved) return "waiting_for_moisture";
  return approved.decision === "ok" ? "waiting_for_weighing" : "on_hold";
}

/** A new check is taken while the load waits for one, or after it was put on hold to dry. */
export const canTakeMoistureCheck = (status: RcnReceiptStatus): boolean => status === "waiting_for_moisture" || status === "on_hold";

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
