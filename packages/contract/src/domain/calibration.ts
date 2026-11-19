/**
 * Production Phase 2: Calibration. A load that finished Intake is run through the sizing machine into 9 storage
 * silos, the QFS Officer samples each silo (QC-2), and a silo that fails is re-sized by hand (Wholes Manual
 * Calibration). Source: the client's "Production module" document (Oct 2026), Phase 2, and its workbooks
 * docs/Production/4. Calibration Process report, 5. Calibrated RCN Silos Stock report and 24. Wholes Manual
 * Calibration (Sheet2).
 *
 * Decision, Nov 2026 (both sides agreed): nobody weighs what goes into each of the 9 silos, only the total is known,
 * and the total is enough. So Intake and Calibration are one stage: a load's net − dust − voids (rcnWeighing.ts's
 * toSilosKg) goes into the silos as one total when production accepts it, and each production run's silo stock is
 * tracked as its own total (Nov 2026: "each production run is different"), never one pool across runs.
 * The sizes stay for QC-2 samples, moves by hand and the cooking sheet, which do name a silo.
 */

/**
 * The 9 silos, largest first, as the silo stock report's columns: "Size A++ (>25mm)" … "Size E (18mm)". The QC-2
 * sheet names the smallest one DE (same 18 mm); `sheet` is that sheet's own column word, so an import can match it.
 */
export const SILO_SIZES = [
  { key: "App", code: "A++", mm: ">25 mm", sheet: "A++" },
  { key: "Ap", code: "A+", mm: "25 mm", sheet: "A+" },
  { key: "A", code: "A", mm: "24 mm", sheet: "A" },
  { key: "AB", code: "AB", mm: "23 mm", sheet: "AB" },
  { key: "B", code: "B", mm: "22 mm", sheet: "B" },
  { key: "BC", code: "BC", mm: "21 mm", sheet: "BC" },
  { key: "C", code: "C", mm: "20 mm", sheet: "C" },
  { key: "D", code: "D", mm: "19 mm", sheet: "D" },
  { key: "E", code: "E", mm: "18 mm", sheet: "DE" },
] as const;

export type SiloSize = (typeof SILO_SIZES)[number]["key"];

export const SILO_SIZE_KEYS: SiloSize[] = SILO_SIZES.map((s) => s.key);

export const siloLabel = (key: SiloSize): string => {
  const s = SILO_SIZES.find((x) => x.key === key)!;
  return `${s.code} (${s.mm})`;
};

export const isSiloSize = (v: unknown): v is SiloSize => typeof v === "string" && (SILO_SIZE_KEYS as string[]).includes(v);

const num = (v: string | undefined | null): number | null => {
  const t = (v ?? "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

const kg2 = (n: number) => Math.round(n * 100) / 100;

export type SizeValues = Partial<Record<SiloSize, string>>;

/** Σ of the kg typed per size; blanks count as 0. */
export const sizesTotal = (v: SizeValues): number => kg2(SILO_SIZE_KEYS.reduce((n, k) => n + (num(v[k]) || 0), 0));

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

// ── QC-2 sizing check ──────────────────────────────────────────────────────────────────

/**
 * Where the QC-2 sample was taken: one of the 9 silos, or the RCN as received, before calibration (the sheet's
 * "Received RCN" / "Before Calibration" rows), which has no size of its own to be correct against.
 */
export type SamplingPoint = SiloSize | "received";

export const isSamplingPoint = (v: unknown): v is SamplingPoint => v === "received" || isSiloSize(v);

export const samplingPointLabel = (p: SamplingPoint): string => (p === "received" ? "Received RCN (before calibration)" : `Silo ${siloLabel(p)}`);

/**
 * The grams the sample is sorted into: the 9 sizes plus what falls through the smallest screen (the sheet's
 * "< DE", 17 mm), which has no silo.
 */
export const SIZING_GRADES = [...SILO_SIZE_KEYS, "under"] as const;
export type SizingGrade = (typeof SIZING_GRADES)[number];
export const sizingGradeLabel = (g: SizingGrade): string => (g === "under" ? "Under E (<18 mm)" : siloLabel(g));

/** The doc: "1,000 g sample; alert if less than 85 % is the correct size". */
export const CORRECT_SIZE_TARGET_PCT = 85;

/** "OK" or "No" (the doc's QC-2 = NO: the silo is flagged and re-sized by hand). */
export type SizingDecision = "ok" | "fail";
export const SIZING_DECISION_LABELS: Record<SizingDecision, string> = { ok: "OK", fail: "Fail · re-size by hand" };

export type SizingGrams = Partial<Record<SizingGrade, string>>;

export const sizingGramsTotal = (g: SizingGrams): number => SIZING_GRADES.reduce((n, k) => n + (num(g[k]) || 0), 0);

/**
 * "Correct size % = grams of the silo's own size ÷ sample". Null for a received-RCN sample (no own size) or
 * without a sample weight.
 *
 * Measured on the client's 99 silo samples (Aug–Sep 2026): none reaches 85 % by this rule (median 30.5 %),
 * and on every one the largest share is in the next size down (silo A+ → 79 % "A"). Shown as the doc defines
 * it, never re-read one column over; the decision stays the QFS Officer's.
 */
export function correctSizePct(point: SamplingPoint, sampleG: string | undefined, grams: SizingGrams): number | null {
  return point === "received" ? null : sizingGradePct(point, sampleG, grams);
}

/** One size's share of the sample: the sheet's "A++ %" … "< DE %" columns. Null without a sample weight. */
export function sizingGradePct(grade: SizingGrade, sampleG: string | undefined, grams: SizingGrams): number | null {
  const sample = num(sampleG);
  if (sample === null || Number.isNaN(sample) || sample <= 0) return null;
  return ((num(grams[grade]) || 0) / sample) * 100;
}

/** The size most of the sample turned out to be, other than the silo's own: where its nuts probably belong. Null if none. */
export function largestOtherGrade(point: SamplingPoint, grams: SizingGrams): SiloSize | null {
  let best: SiloSize | null = null;
  for (const k of SILO_SIZE_KEYS) {
    if (k !== point && (num(grams[k]) || 0) > 0 && (best === null || (num(grams[k]) || 0) > (num(grams[best]) || 0))) best = k;
  }
  return best;
}

export interface SizingCheckValues {
  date?: string;
  point?: string;
  nutCount?: string;
  sampleG?: string;
  grams?: SizingGrams;
  decision?: string;
}

export const DEFAULT_SIZING_SAMPLE_G = "1000";

export function sizingCheckError(v: SizingCheckValues): string | null {
  if (!(v.date ?? "").trim()) return "A date is required.";
  if (!isSamplingPoint(v.point)) return "Choose the silo the sample was taken from.";
  const nut = num(v.nutCount);
  if (nut !== null && (Number.isNaN(nut) || nut <= 0)) return "Nut count must be a number above 0.";
  const sample = num(v.sampleG);
  if (sample === null) return "Enter the sample weight.";
  if (Number.isNaN(sample) || sample <= 0) return "Sample weight must be a number of grams above 0.";
  for (const g of SIZING_GRADES) {
    const n = num(v.grams?.[g]);
    if (n !== null && (Number.isNaN(n) || n < 0)) return `${sizingGradeLabel(g)} must be a number of grams, 0 or more.`;
  }
  if (sizingGramsTotal(v.grams ?? {}) <= 0) return "Enter the grams found in each size.";
  if (v.decision !== "ok" && v.decision !== "fail") return "Choose OK or Fail.";
  return null;
}

/**
 * Soft notes, never refusals — the doc lists both as alerts: "sample parts ≠ sample weight" (4 of the sheet's 103
 * rows are off, by −54 to +6 g) and "correct-size % below 85".
 */
export function sizingCheckNotes(v: SizingCheckValues): string[] {
  const notes: string[] = [];
  const sample = num(v.sampleG);
  const total = sizingGramsTotal(v.grams ?? {});
  if (sample !== null && !Number.isNaN(sample) && total > 0 && Math.abs(total - sample) > 0.0001) {
    notes.push(`The grams add up to ${fmt(total)} g, not the ${fmt(sample)} g sample.`);
  }
  if (isSamplingPoint(v.point)) {
    const pct = correctSizePct(v.point, v.sampleG, v.grams ?? {});
    if (pct !== null && pct < CORRECT_SIZE_TARGET_PCT) notes.push(`Only ${pct.toFixed(1)} % is the silo's own size (target ${CORRECT_SIZE_TARGET_PCT} %).`);
  }
  return notes;
}

/**
 * Where a silo stands on QC-2. The doc: "QC-2 = NO: silo is flagged", and a check answered No "is repeated" after
 * the material goes back a step, so a re-sized silo asks for a new check rather than reading as passed.
 */
export type SiloCheckState = "not_checked" | "ok" | "failed" | "re_sized";

export const SILO_CHECK_LABELS: Record<SiloCheckState, string> = {
  not_checked: "Not checked yet",
  ok: "OK",
  failed: "Failed · move the nuts",
  re_sized: "Nuts moved · check again",
};

export type CalibrationStep = "check" | "fix" | "none";

/**
 * The one job to point this person at. Only what they can act on: a QFS Officer is never sent to approve their own
 * check, so with nothing to sample they are simply told there is nothing to do.
 */
export function nextCalibrationStep(v: { canSize: boolean; canCheck: boolean; checksWaiting: number; failedSilos: number; silosToCheck: number }): CalibrationStep {
  if (v.canSize && v.checksWaiting > 0) return "check";
  if (v.canSize && v.failedSilos > 0) return "fix";
  if (v.canCheck && v.silosToCheck > 0) return "check";
  return "none";
}

export interface SiloCheck {
  state: SiloCheckState;
  /** The deciding check's correct-size %, date and id; null when not checked. */
  correctPct: number | null;
  date: string | null;
  checkId: number | null;
}

/**
 * Each silo's standing, from its newest approved check. A check waiting for approval or rejected changes nothing,
 * as with a moisture check ("saved as pending; nothing changes yet").
 */
export function siloChecks(
  checks: { id: number; point: string; status: string; decision: string; date: string; correctPct: number | null; moves: number }[],
): Record<SiloSize, SiloCheck> {
  const out = Object.fromEntries(SILO_SIZE_KEYS.map((k) => [k, { state: "not_checked", correctPct: null, date: null, checkId: null }])) as Record<SiloSize, SiloCheck>;
  const newestFirst = checks.filter((c) => c.status === "approved").sort((a, b) => b.id - a.id);
  for (const size of SILO_SIZE_KEYS) {
    const c = newestFirst.find((x) => x.point === size);
    if (c) out[size] = { state: c.decision === "ok" ? "ok" : c.moves > 0 ? "re_sized" : "failed", correctPct: c.correctPct, date: c.date, checkId: c.id };
  }
  return out;
}

/**
 * The silos that still need someone: a failed one to fix, a fixed one to check again. With the silos tracked as one
 * total, which silo holds nuts isn't known, so a silo never checked isn't asked for; sampling it stays the QFS
 * Officer's call. Silos that are empty in total have nothing to sample or move.
 */
export function silosWaiting(stockKg: number, checks: Record<SiloSize, SiloCheck>): { toCheck: SiloSize[]; failed: SiloSize[]; moved: SiloSize[] } {
  const all = stockKg > 0 ? SILO_SIZE_KEYS : [];
  const moved = all.filter((s) => checks[s].state === "re_sized");
  return { toCheck: moved, failed: all.filter((s) => checks[s].state === "failed"), moved };
}

// ── Wholes manual calibration ──────────────────────────────────────────────────────────

export interface ManualCalibrationValues {
  date?: string;
  fromSize?: string;
  toSize?: string;
  kg?: string;
}

/**
 * "Only after a failed QC-2; kg moves between silos." Recorded as typed: no silo's own kg is known, so the move can't
 * be held to one, and it never changes the silos' total.
 */
export function manualCalibrationError(v: ManualCalibrationValues): string | null {
  if (!(v.date ?? "").trim()) return "A date is required.";
  if (!isSiloSize(v.fromSize)) return "Choose the silo the nuts are taken from.";
  if (!isSiloSize(v.toSize)) return "Choose the silo the nuts go into.";
  if (v.fromSize === v.toSize) return "The nuts must move to a different silo.";
  const kg = num(v.kg);
  if (kg === null) return "Enter the kg moved.";
  if (Number.isNaN(kg) || kg <= 0) return "Kg moved must be a number above 0.";
  return null;
}

// ── Silo stock ──────────────────────────────────────────────────────────────────────────────────

/** The silos as one pool: what calibrated loads put in, minus what was cooked out. */
export interface SiloPool {
  inKg: number;
  cookedKg: number;
  stockKg: number;
}

/** "Silo stock = opening + calibrated in − cooked". Opening is 0: the app's silos start empty. */
export function siloPool(loads: { kg: number }[], cooks: { sizes: SizeValues }[] = []): SiloPool {
  const inKg = kg2(loads.reduce((n, l) => n + l.kg, 0));
  const cookedKg = kg2(cooks.reduce((n, c) => n + sizesTotal(c.sizes), 0));
  return { inKg, cookedKg, stockKg: kg2(inKg - cookedKg) };
}

/**
 * "5. Calibrated RCN Silos Stock report", one row per day: opening + calibrated in − cooked = closing. Calculated from
 * the loads and cooking rows, so it can't drift from the silo stock above. A move by hand shifts nuts between silos
 * and leaves the total alone (the report's "Adjusted qty"), so it shows in `movedKg`, not in closing.
 */
export interface SiloDay {
  date: string;
  openingKg: number;
  inKg: number;
  cookedKg: number;
  movedKg: number;
  closingKg: number;
}

export function siloDailyStock(
  loads: { date: string; kg: number }[],
  moves: { date: string; kg: string }[],
  cooks: { date: string; sizes: SizeValues }[] = [],
): SiloDay[] {
  const dates = [...new Set([...loads.map((l) => l.date), ...moves.map((m) => m.date), ...cooks.map((c) => c.date)])].sort();
  let closing = 0;
  return dates.map((date) => {
    const inKg = kg2(loads.filter((l) => l.date === date).reduce((n, l) => n + l.kg, 0));
    const cookedKg = kg2(cooks.filter((c) => c.date === date).reduce((n, c) => n + sizesTotal(c.sizes), 0));
    const movedKg = kg2(moves.filter((m) => m.date === date).reduce((n, m) => n + (num(m.kg) || 0), 0));
    const openingKg = closing;
    closing = kg2(openingKg + inKg - cookedKg);
    return { date, openingKg, inKg, cookedKg, movedKg, closingKg: closing };
  });
}

/** A silo as a workbook writes it: the report's "A++", the QC-2 sheet's "DE", or our own "E". Null when it's none of them. */
export function siloFromWord(word: string | null | undefined): SiloSize | null {
  const w = (word ?? "").trim().toUpperCase();
  return SILO_SIZES.find((s) => s.code === w || s.sheet === w)?.key ?? null;
}

/** The QC-2 sheet's "Sampling Point": a silo, or the RCN as it was received ("Received RCN", "Before Calibration"). */
export function samplingPointFromWord(word: string | null | undefined): SamplingPoint | null {
  const w = (word ?? "").trim().toLowerCase();
  if (w.startsWith("received") || w.startsWith("before cal")) return "received";
  return siloFromWord(word);
}
