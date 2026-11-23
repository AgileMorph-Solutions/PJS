/**
 * Sun drying, as the client asked for it (Oct 2026): a Lot is dried in rounds. Each round is issued (weight and quality
 * before), comes back (weight after), and is quality-checked (moisture, nut count and a cut test after). The check either
 * passes the Lot or sends it back for another round, starting from what came back. The QFS reception sample stays its own,
 * separate measurement: drying never overwrites it and its "before" figures are measured again, not copied from it.
 *
 * One round is one DryingBatch row; later rounds point at the first (`firstBatchId`) and carry `round` 2, 3 …
 */
import { korFromGrams } from "./receiptMath.js";
import { numberProblem, type NumberRule } from "./fieldRules.js";

export const DRYING_STATUS = {
  inDrying: "IN DRYING",
  qualityCheck: "QUALITY CHECK",
  passed: "PASSED",
  redry: "RE-DRY",
  /** The exception (Sameer, 18 Nov 2026): dried RCN whose KOR suits what production has planned goes straight there, with no
   * new Bin. Whether the KOR suits is judged by people, not by the app; the app records that it went. */
  toProduction: "SENT TO PRODUCTION",
} as const;

export type DryingPhase = "in_drying" | "quality_check" | "passed" | "redry" | "to_production" | "other";

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
  if (s === DRYING_STATUS.toProduction) return "to_production";
  return "other";
}

export const DRYING_PHASE_LABELS: Record<DryingPhase, string> = {
  in_drying: "In drying",
  quality_check: "Awaiting quality check",
  passed: "Passed",
  redry: "Sent for re-drying",
  to_production: "Sent straight to production",
  other: "Recorded",
};

/** Where a truck unloaded straight onto the drying yard was dried from: it has no Bin until the dried RCN is re-bagged. */
export const DRYING_YARD = "Drying yard";

/**
 * Drying from a Bin (Sameer, 18 Nov 2026): RCN goes from a Bin to the drying yard and, once dry, is re-bagged into a NEW Bin.
 * So the source Bin is required, and the Bin it comes back to can't be that same Bin. `destination` may still be blank while
 * the RCN is out (decided when it comes back).
 */
export function binDryingProblem(source: string | null | undefined, destination: string | null | undefined): string | null {
  const from = (source ?? "").trim().toUpperCase();
  const to = (destination ?? "").trim().toUpperCase();
  if (!from) return "Choose the Bin the RCN is taken from for drying.";
  if (to && to === from) return `The dried RCN goes into a new Bin: choose a Bin other than ${from}, the one it was taken from.`;
  return null;
}

/**
 * Whether a truck's own drying — straight off the truck onto the yard — ended with the RCN sent straight to production: its
 * latest in-app round says so. Such a truck never gets a Bin (Sameer, 18 Nov 2026), so its GRN doesn't wait for one
 * (phaseGate). Rows imported from the drying workbook don't count: the app didn't record that decision for them.
 */
export function wentStraightToProduction(rounds: readonly { sn: number; source: string | null; status: string | null }[]): boolean {
  const latest = rounds.filter((r) => r.source === "entered").sort((a, b) => a.sn - b.sn).at(-1);
  return latest !== undefined && dryingPhase(latest.status) === "to_production";
}

/** A round that is still open: the Lot is on the yard, or back and waiting for its quality check. */
export const isOpenRound = (status: string | null | undefined) => {
  const p = dryingPhase(status);
  return p === "in_drying" || p === "quality_check";
};

type TruckRound = { sn: number; source: string | null; status: string | null };
const latestEntered = (rounds: readonly TruckRound[]) => rounds.filter((r) => r.source === "entered").sort((a, b) => a.sn - b.sn).at(-1);

/**
 * The truck's RCN is out on the drying yard right now: its own drying (straight off the truck) has a round open. Until it
 * comes back the truck is in no Bin, so its Bin step waits (phaseGate) — the RCN can't be on the yard and in a Bin at once.
 */
export function onDryingYard(rounds: readonly TruckRound[]): boolean {
  const latest = latestEntered(rounds);
  return latest !== undefined && isOpenRound(latest.status);
}

/**
 * Why a truck's own drying — straight off the truck onto the yard — can't start, or undefined when it can (23 Nov 2026: a
 * truck already in a Bin was also "unloaded straight onto the drying yard", and its Bin offered drying the same RCN again).
 * The two ways to dry are exclusive: a truck with no Bin is dried from the yard, here; once it is in a Bin, its RCN is dried
 * from that Bin (Warehouse activities), with the Bin's other Lots. RCN sent straight to production has nothing left to dry.
 */
export function truckDryingBlocker(binNo: string | null | undefined, rounds: readonly TruckRound[]): string | undefined {
  const latest = latestEntered(rounds);
  if (latest && dryingPhase(latest.status) === "to_production") return "This truck's RCN was sent straight to production from the drying yard: there is nothing left to dry.";
  const bin = (binNo ?? "").trim();
  if (bin && latest) return `This truck's dried RCN is in Bin ${bin} now. To dry it again, start the drying from Bin ${bin} in Warehouse activities.`;
  if (bin) return `This truck is in Bin ${bin}, so it wasn't unloaded straight onto the drying yard. To dry it, start the drying from Bin ${bin} in Warehouse activities.`;
  return undefined;
}

/** Why this much can't be taken from a Bin for drying, or null: a Bin can't give more RCN than it holds (its stock is worked out, never typed). */
export function binDryingStockProblem(binCode: string, binKg: number, issuedKg: number): string | null {
  if (binKg <= 0) return `Bin ${binCode} holds no RCN right now, so there is nothing to dry from it.`;
  if (issuedKg > binKg) return `Bin ${binCode} holds ${binKg.toLocaleString("en-US")} kg: you can't take ${issuedKg.toLocaleString("en-US")} kg out of it for drying.`;
  return null;
}

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

/**
 * The drying form's fields, by the key the form and the API use (inputMoisture, outputGoodKernelG, issuedNetKg …), checked
 * with the same number rules as a truck's fields (fieldRules numberProblem), so they read the same (team, 23 Nov 2026:
 * "reuse what we have for KOR and moisture"). The impossible ones — not a number, outside the limits — the server refuses
 * too (dryingQualityProblem, services/dryingBatches.ts); still-wet moisture after drying is only a warning.
 */
const MOISTURE_RULE: NumberRule = { min: 0, max: 100, unit: "%" };
const DRYING_RULES: Record<string, NumberRule> = {
  inputMoisture: MOISTURE_RULE,
  // 10 % is the trade standard (fieldRules MOISTURE): dried RCN above it is likely still too wet.
  outputMoisture: { ...MOISTURE_RULE, warnAbove: [10, "still too wet, consider drying it again"] },
  inputNutCount: { integer: true, min: 0 },
  outputNutCount: { integer: true, min: 0 },
  inputKor: { min: 0, max: 80, unit: "lbs" },
  outputKor: { min: 0, max: 80, unit: "lbs" },
  issuedNetKg: { positive: true, unit: "kg" },
  receivedNetKg: { positive: true, unit: "kg" },
  issuedBags: { integer: true, min: 0 },
  receivedBags: { integer: true, min: 0 },
  ...Object.fromEntries(["input", "output"].flatMap((p) =>
    ["GoodKernelG", "ImmatureG", "SpottedG", "RejectionG", "VoidG", "OilG", "ShellG"].map((g) => [`${p}${g}`, { min: 0, max: 1000, unit: "g" } as NumberRule]))),
};

/** The problem with one drying field as typed, or undefined; `soft` is a warning only. */
export function dryingFieldProblem(key: string, raw: string | undefined) {
  const rule = DRYING_RULES[key];
  return rule ? numberProblem(rule, raw) : undefined;
}

/** The cut test is of a 1000 g sample: grams adding up to more can't be right (the server refuses it, dryingQualityProblem). */
export function dryingGramsTotalProblem(values: Record<string, string | undefined>, prefix: "input" | "output"): string | undefined {
  const total = ["GoodKernelG", "ImmatureG", "SpottedG", "RejectionG", "VoidG", "OilG", "ShellG"]
    .map((g) => Number(String(values[`${prefix}${g}`] ?? "").replace(",", ".")))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => a + b, 0);
  return total > 1000 ? `The cut-test grams add up to ${total} g, more than the 1000 g sample.` : undefined;
}

/**
 * Only a Central warehouse sends dried RCN straight to production (team, 23 Nov 2026): production runs there; a Unit
 * warehouse's RCN goes on to Central on a BKT first. So at a Unit the check after drying offers Passed or Dry it again.
 */
export const canSendDryingToProduction = (siteType: string | null | undefined) => siteType === "CENTRAL";
export const DRYING_TO_PRODUCTION_UNIT_MESSAGE = "Only a Central warehouse can send dried RCN straight to production. At a Unit warehouse it goes into a new Bin, then on to Central on a transfer.";

