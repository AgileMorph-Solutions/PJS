/**
 * Production Phase 3: Cooking & cooling. Each size is steam-cooked, rested 24 hours in a cooling silo and checked
 * (QC-4); only then may the Lot be shelled. There is no check after the cooker (QC-3 was dropped, Nov 2026): the cooker
 * log's settings are the record of the cook. Source: the client's "Production module" document
 * (Oct 2026), Phase 3, and docs/Production/6. Cooking Process Report (Sheet1).
 */
import { SILO_SIZES, SILO_SIZE_KEYS, sizesTotal, type SiloSize, type SizeValues } from "./calibration.js";

const num = (v: string | undefined | null): number | null => {
  const t = (v ?? "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** The sheet's "No of Bags" = total ÷ 80 on all 107 cooked Lots. */
export const KG_PER_BAG = 80;
export const lotBags = (totalKg: number): number => totalKg / KG_PER_BAG;

/**
 * "ANG · 26 year · G = July · 16th lot of the month": what the client writes on every sheet (E = May … I = September
 * on all 107 Lots). The app only suggests it; a Lot's code stays typed, as the sheet has real exceptions (ANG26F20A).
 */
export function nextLotCode(date: string, existing: string[]): string {
  const year = date.slice(2, 4);
  const month = Number(date.slice(5, 7));
  const prefix = `ANG${year}${String.fromCharCode(64 + month)}`;
  const seqs = existing.filter((c) => c.startsWith(prefix)).map((c) => parseInt(c.slice(prefix.length), 10)).filter(Number.isFinite);
  return `${prefix}${String(Math.max(0, ...seqs) + 1).padStart(2, "0")}`;
}

export interface CookRunValues {
  date?: string;
  code?: string;
  sizes?: SizeValues;
  /** Damaged or spoiled in the cooker (a power cut, a breakdown): taken from the silos, but it never reaches shelling. */
  damagedKg?: string;
}

/**
 * "Cannot exceed the silo stock." `stockKg` is the silos' total now: calibration records no kg per size (decision,
 * Nov 2026), so the cooking sheet's kg per size are kept as typed but only their total is held to the stock.
 */
export function cookRunError(v: CookRunValues, stockKg: number): string | null {
  if (!(v.date ?? "").trim()) return "A date is required.";
  if (!(v.code ?? "").trim()) return "Give the Lot its number.";
  for (const s of SILO_SIZES) {
    const n = num(v.sizes?.[s.key]);
    if (n !== null && (Number.isNaN(n) || n < 0)) return `Size ${s.code} must be a number of kg, 0 or more.`;
  }
  const total = sizesTotal(v.sizes ?? {});
  if (total <= 0) return "Enter the kg cooked from at least one silo.";
  if (total > Math.round(stockKg * 100) / 100) return `This production run has ${fmt(stockKg)} kg in the silos; ${fmt(total)} kg can't be cooked from it.`;
  const damaged = num(v.damagedKg);
  if (damaged !== null && (Number.isNaN(damaged) || damaged < 0)) return "Damaged or spoiled must be a number of kg, 0 or more.";
  if (damaged !== null && damaged > total) return `Damaged or spoiled can't be more than the ${fmt(total)} kg cooked.`;
  return null;
}

/** The kg per size of a Lot's runs, added up. A Lot can take more than one cooking row (ANG26F01 has two in the sheet). */
export function lotSizes(runs: { sizes: SizeValues }[]): Record<SiloSize, number> {
  return Object.fromEntries(SILO_SIZE_KEYS.map((k) => [k, Math.round(runs.reduce((n, r) => n + (num(r.sizes[k]) || 0), 0) * 100) / 100])) as Record<SiloSize, number>;
}

/** Hours from one "YYYY-MM-DDTHH:MM" to another. Both are factory time as typed, so no timezone comes into it. */
export function hoursBetween(from: string, to: string): number {
  return (Date.parse(`${to}:00Z`) - Date.parse(`${from}:00Z`)) / 3_600_000;
}

/** The doc: "Cooling silo · time in: 24 h clock starts"; QC-4 warns under it. */
export const COOLING_HOURS = 24;

export interface CoolingValues {
  silo?: string;
  date?: string;
  time?: string;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isTime = (v: string | undefined | null): boolean => TIME_RE.test((v ?? "").trim());

export function coolingError(v: CoolingValues): string | null {
  if (!(v.silo ?? "").trim()) return "Enter the cooling silo.";
  if (!(v.date ?? "").trim()) return "A date is required.";
  if (!isTime(v.time)) return "Enter the time the Lot went in, as HH:MM.";
  return null;
}

interface CheckLike {
  id: number;
  status: string;
  decision: string | null;
  values: Record<string, string | undefined>;
}

/** QC-4: "Wait → re-check", and "shelling cannot start on it" until the newest approved one says OK. */
export type CoolingCheckState = "not_checked" | "waiting" | "ok" | "wait";

export function coolingCheck(qc4: CheckLike[]): CoolingCheckState {
  const newestFirst = [...qc4].filter((c) => c.status !== "rejected").sort((a, b) => b.id - a.id);
  if (newestFirst[0]?.status === "submitted") return "waiting";
  const decided = newestFirst.find((c) => c.status === "approved");
  return !decided ? "not_checked" : decided.decision === "ok" ? "ok" : "wait";
}

/** The doc's Lot statuses as far as Colour sort, plus its step 5 "Ready for shelling". Worked out from the records, never typed. */
export type LotStatus = "cooking" | "cooling" | "ready" | "shelled" | "colour_sorted";

export const LOT_STATUS_LABELS: Record<LotStatus, string> = {
  cooking: "Cooking",
  cooling: "Cooling",
  ready: "Ready for shelling",
  shelled: "Shelled",
  colour_sorted: "Colour sorted",
};

export function lotStatus(v: { inCooling: boolean; cooling: CoolingCheckState; shellingDays: number; colourSorted?: boolean }): LotStatus {
  if (v.shellingDays > 0) return v.colourSorted ? "colour_sorted" : "shelled";
  if (!v.inCooling) return "cooking";
  return v.cooling === "ok" ? "ready" : "cooling";
}

/** Past QC-4, so anything of Phase 4 may be recorded on it. */
export const canShell = (status: LotStatus): boolean => status === "ready" || status === "shelled" || status === "colour_sorted";

/** Shelled, so the sorter has its kernels: Phase 5 may be recorded on it. */
export const canColourSort = (status: LotStatus): boolean => status === "shelled" || status === "colour_sorted";

export type CookingStep = "cook" | "cooker_log" | "cooling" | "qc4" | "none";

/**
 * The one job to point this person at, for a Lot still in Phase 3. A QFS Officer is only sent to a check, the
 * Incharge also to the floor's jobs and to approvals.
 */
export function nextCookingStep(v: { canFloor: boolean; canCheck: boolean; canReview: boolean; loggedSizes: SiloSize[]; sizes: SiloSize[]; inCooling: boolean; cooling: CoolingCheckState }): CookingStep {
  if (!v.inCooling) {
    if (!v.canFloor) return "none";
    return v.sizes.some((s) => !v.loggedSizes.includes(s)) ? "cooker_log" : "cooling";
  }
  if (v.canReview && v.cooling === "waiting") return "qc4";
  if (v.canCheck && (v.cooling === "not_checked" || v.cooling === "wait")) return "qc4";
  return "none";
}
