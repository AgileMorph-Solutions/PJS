/**
 * The order a truck's record is filled in (docs/procurement-field-rules.png, "Phase order"): a phase opens only when the
 * one before it is complete, so a later step can't be filled on top of an earlier one that is missing what makes it mean
 * anything (a quality result with no moisture, a GRN with no bin).
 *
 *   Arrival → Weight → Quality → Unloading → (Lot, issued on Pass) → Bin → GRN → Drying / Other activities / Transfer
 *
 * One function answers "is this stage open, and if not, what is missing?" for both sides: the backend refuses a write to a
 * closed stage, the screens show it locked with the same message. It holds for records entered in the app. Imported records
 * (the 2026 workbooks) never had most of these fields, so the backend doesn't gate them; their gaps are Data Quality's job.
 */
import type { ReceiptRecord } from "../types/receipt.js";
import { stages } from "../data/stages.js";
import { computeDerivedFields } from "./receiptMath.js";
import { isGrnComplete } from "./recordLock.js";

type StageData = ReceiptRecord["stageData"];
type Ref = readonly [stageId: string, label: string];

export interface Phase {
  id: string;
  title: string;
  /** Every field that must be filled for the phase to count as complete. */
  required: readonly Ref[];
}

const ARRIVAL: Phase = {
  id: "arrival",
  title: "Arrival",
  required: [
    ["n-gate", "DATE OF ARRIVAL"],
    ["n-gate", "CREDIT/CASH"],
    ["n-gate", "WH LOCATION"],
    ["n-gate", "VEHICLE NO."],
    ["n-verify", "SUPPLIERS NAME"],
    ["n-verify", "LBA CODE"],
    ["n-verify", "FICHE CODE"],
    ["n-verify", "FICHE"],
    ["n-verify", "ORIGIN"],
  ],
};
const WEIGHT: Phase = {
  id: "weight",
  title: "Weight",
  required: [["n-gross", "GROSS WT KGS"]],
};
/** What a Pass needs: without the sample readings the quality result means nothing. */
const QUALITY_SAMPLE: Phase = {
  id: "quality",
  title: "Quality",
  required: [
    ["n-qfs", "Sample moisture (%)"],
    ["n-qfs", "Sample nut count"],
    ["n-qfs", "KOR"],
  ],
};
/** Measured after unloading, so asked for before the GRN rather than before Pass. */
const QUALITY_FINAL: Phase = {
  id: "quality-final",
  title: "Quality (final readings)",
  required: [
    ["n-qfs", "Final moisture (%)"],
    ["n-qfs", "Final nut count"],
    ["n-qfs", "FINAL KOR"],
  ],
};
const UNLOADING: Phase = {
  id: "unloading",
  title: "Unloading",
  required: [
    ["n-unload", "DATE OF OFFLOADING"],
    ["n-unload", "BON SACS (good bags)"],
    ["n-unload", "HUMID SACS (damp bags)"],
    ["n-unload", "Sacs déchirés (torn bags)"],
    ["n-unload", "Refraction"],
    ["n-unload", "Tally Clerk bag count"],
  ],
};
const BIN: Phase = {
  id: "bin",
  title: "Bin",
  required: [
    ["n-bin", "Bin Number"],
    ["n-bin", "Basis for allocation (moisture / quality / KOR / space)"],
    ["n-bin", "Bin allocation date"],
  ],
};

/** What makes the GRN complete (recordLock.ts's isGrnComplete), named so the message can list what is missing. */
const GRN_FIELDS: readonly Ref[] = [
  ["n-grn", "GRN Weight (kept separate from Gross/Net/Paid)"],
  ["n-grn", "PRICE"],
];

export const PHASES = {
  ARRIVAL,
  WEIGHT,
  QUALITY_SAMPLE,
  QUALITY_FINAL,
  UNLOADING,
  BIN,
} as const;

/** What a stage waits for. `pass`: the truck passed quality. `grn`: the GRN is complete (quantity and price). */
type Need = Phase | "pass" | "grn";

/** Stage → the phases that must be complete before it opens. A stage not listed is always open. */
const OPENS_AFTER: Record<string, readonly Need[]> = {
  "n-gross": [ARRIVAL],
  "n-qfs": [ARRIVAL, WEIGHT],
  "n-unload": [ARRIVAL, WEIGHT, "pass"],
  "n-netwt": [ARRIVAL, WEIGHT, "pass"],
  "n-bin": [ARRIVAL, WEIGHT, "pass", UNLOADING],
  "n-grn": [ARRIVAL, WEIGHT, "pass", UNLOADING, BIN, QUALITY_FINAL],
  "n-stock": ["grn"],
  "n-drying": ["grn"],
  "n-otheract": ["grn"],
  "n-ledger": ["grn"],
  "n-xferdec": ["grn"],
};

export interface StageGate {
  open: boolean;
  /** The first phase still to be finished. */
  waitingFor?: string;
  /** The empty fields of that phase, by the label the person sees. */
  missing: string[];
  /** One plain sentence for the screen and the API error. */
  message?: string;
}

const label = ([stageId, n]: Ref) => {
  const f = stages.find((s) => s.id === stageId)?.fields.find((x) => x.n === n);
  return f?.label ?? n;
};

/** The empty fields of a phase. Calculated fields count when the system can calculate them (Gross from the two weights). */
export function missingFields(stageData: StageData, phase: Phase): string[] {
  const derived = computeDerivedFields(stageData);
  return phase.required
    .filter(([s, l]) => !(derived[s]?.[l] ?? stageData[s]?.[l] ?? "").trim())
    .map(label);
}

const TITLES: Record<string, string> = {
  "n-gross": "Weight",
  "n-qfs": "Quality",
  "n-unload": "Unloading",
  "n-netwt": "Unloading",
  "n-bin": "Bin",
  "n-grn": "GRN",
  "n-stock": "Warehouse stock",
  "n-drying": "Drying",
  "n-otheract": "Other activities",
  "n-ledger": "Activity ledger",
  "n-xferdec": "Transfer",
};

const listOf = (xs: string[]) =>
  xs.length <= 4
    ? xs.join(", ")
    : `${xs.slice(0, 4).join(", ")} and ${xs.length - 4} more`;

/** Is this stage open on this record, and if not, what must be done first. */
export function stageGate(
  r: Pick<ReceiptRecord, "stageData" | "branches">,
  stageId: string,
): StageGate {
  const title = TITLES[stageId] ?? stageId;
  for (const need of OPENS_AFTER[stageId] ?? []) {
    if (need === "pass") {
      if (r.branches["n-qfs"] === "pass") continue;
      return {
        open: false,
        waitingFor: "Quality",
        missing: [],
        message: `${title} is locked. The truck must pass Quality first.`,
      };
    }
    if (need === "grn") {
      if (isGrnComplete(r.stageData)) continue;
      const missing = GRN_FIELDS.filter(
        ([s, l]) => !(r.stageData[s]?.[l] ?? "").trim(),
      ).map(label);
      return {
        open: false,
        waitingFor: "GRN",
        missing,
        message: `${title} is locked until the GRN is complete. Missing: ${listOf(missing)}.`,
      };
    }
    const missing = missingFields(r.stageData, need);
    if (missing.length) {
      return {
        open: false,
        waitingFor: need.title,
        missing,
        message: `${title} is locked. Please finish ${need.title} first: ${listOf(missing)}.`,
      };
    }
  }
  return { open: true, missing: [] };
}

/** Passing quality needs the sample readings: the reason the Pass option is unavailable, or undefined when it may be chosen. */
export function passBlocked(stageData: StageData): string | undefined {
  const missing = missingFields(stageData, QUALITY_SAMPLE);
  return missing.length
    ? `Can't pass this truck yet. Quality needs ${listOf(missing)} first.`
    : undefined;
}

/** The decisions that sit inside a gated stage, so a decision is gated like its stage's fields. */
export function decisionGate(
  r: Pick<ReceiptRecord, "stageData" | "branches">,
  stageId: string,
  branchId: string,
): StageGate {
  const gate = stageGate(r, stageId);
  if (!gate.open) return gate;
  if (stageId === "n-qfs" && branchId === "pass") {
    const msg = passBlocked(r.stageData);
    if (msg)
      return {
        open: false,
        waitingFor: "Quality",
        missing: missingFields(r.stageData, QUALITY_SAMPLE),
        message: msg,
      };
  }
  return gate;
}
