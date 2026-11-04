/**
 * Production Phase 2: Calibration. A load that finished Intake is run through the sizing machine into 9 storage
 * silos, the QFS Officer samples each silo (QC-2), and a silo that fails is re-sized by hand (Wholes Manual
 * Calibration). Source: the client's "Production module" document (Oct 2026), Phase 2, and its workbooks
 * docs/Production/4. Calibration Process report, 5. Calibrated RCN Silos Stock report and 24. Wholes Manual
 * Calibration (Sheet2).
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

// ── Step 2 · Kg into each silo ──────────────────────────────────────────────────────────────────

export interface CalibrationRunValues {
  date?: string;
  sizes?: SizeValues;
}

/**
 * One run of a load through the sizing machine. A load can take several runs over several days — in the client's
 * Calibration Process report BTM 1001's two receipts (48,699.15 kg each) went in as 17,966.1 + 30,733.05 and
 * 33,956.05 + 14,743.1 — so a run can't size more than what is still left of the load, and the load is
 * Calibrated once its runs add up to its into-silo kg.
 */
export function calibrationRunError(v: CalibrationRunValues, leftKg: number): string | null {
  if (!(v.date ?? "").trim()) return "A date is required.";
  for (const s of SILO_SIZES) {
    const n = num(v.sizes?.[s.key]);
    if (n !== null && (Number.isNaN(n) || n < 0)) return `Size ${s.code} must be a number of kg, 0 or more.`;
  }
  const total = sizesTotal(v.sizes ?? {});
  if (total <= 0) return "Enter the kg that went into at least one silo.";
  if (leftKg <= 0) return "This load is already fully calibrated.";
  if (total > kg2(leftKg)) return `The sizes add up to ${fmt(total)} kg, more than the ${fmt(leftKg)} kg of this load still to calibrate.`;
  return null;
}

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Into-silo kg of the load, how much its runs have sized so far, and what is left. */
export function calibrationProgress(toSilosKg: number, runs: { sizes: SizeValues }[]): { toSilosKg: number; sizedKg: number; leftKg: number } {
  const sizedKg = kg2(runs.reduce((n, r) => n + sizesTotal(r.sizes), 0));
  return { toSilosKg, sizedKg, leftKg: kg2(toSilosKg - sizedKg) };
}

// ── Step 3 · QC-2 sizing check ──────────────────────────────────────────────────────────────────

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
  if (point === "received") return null;
  const sample = num(sampleG);
  if (sample === null || Number.isNaN(sample) || sample <= 0) return null;
  return ((num(grams[point]) || 0) / sample) * 100;
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

// ── Step 4 · Wholes manual calibration ──────────────────────────────────────────────────────────

export interface ManualCalibrationValues {
  date?: string;
  fromSize?: string;
  toSize?: string;
  kg?: string;
}

/** "Only after a failed QC-2; kg moves between silos." `fromStockKg` is the stock of the silo it leaves. */
export function manualCalibrationError(v: ManualCalibrationValues, fromStockKg: number | null): string | null {
  if (!(v.date ?? "").trim()) return "A date is required.";
  if (!isSiloSize(v.fromSize)) return "Choose the silo the nuts are taken from.";
  if (!isSiloSize(v.toSize)) return "Choose the silo the nuts go into.";
  if (v.fromSize === v.toSize) return "The nuts must move to a different silo.";
  const kg = num(v.kg);
  if (kg === null) return "Enter the kg moved.";
  if (Number.isNaN(kg) || kg <= 0) return "Kg moved must be a number above 0.";
  if (fromStockKg !== null && kg > kg2(fromStockKg)) return `Silo ${siloLabel(v.fromSize)} holds ${fmt(fromStockKg)} kg; ${fmt(kg)} kg can't be moved out of it.`;
  return null;
}

// ── Step 5 · Silo stock ─────────────────────────────────────────────────────────────────────────

export interface SiloStock {
  size: SiloSize;
  sizedInKg: number;
  manualInKg: number;
  manualOutKg: number;
  /** Phase 3 (Cooking) takes nuts out of the silos; 0 until it exists. */
  cookedKg: number;
  stockKg: number;
}

/** "Silo stock (each size) = opening + sized in − cooked ± manual calibration". Opening is 0: the app's silos start empty. */
export function siloStock(
  runs: { sizes: SizeValues }[],
  moves: { fromSize: string; toSize: string; kg: string }[],
): SiloStock[] {
  return SILO_SIZE_KEYS.map((size) => {
    const sizedInKg = kg2(runs.reduce((n, r) => n + (num(r.sizes[size]) || 0), 0));
    const manualInKg = kg2(moves.filter((m) => m.toSize === size).reduce((n, m) => n + (num(m.kg) || 0), 0));
    const manualOutKg = kg2(moves.filter((m) => m.fromSize === size).reduce((n, m) => n + (num(m.kg) || 0), 0));
    const cookedKg = 0;
    return { size, sizedInKg, manualInKg, manualOutKg, cookedKg, stockKg: kg2(sizedInKg + manualInKg - manualOutKg - cookedKg) };
  });
}
