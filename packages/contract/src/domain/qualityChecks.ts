/**
 * Every quality check in the app, by the section it belongs to (user, 26 Nov 2026: "the QFS officer should know which section
 * and where this form is coming from"). The QFS Officer takes every one of them and sends it for approval: a warehouse check to
 * the Warehouse Incharge, a production check to the Production Incharge. The Incharge's or an Admin's own entry still saves as
 * it is typed.
 *
 * One registry, read by the QFS Officer's "Quality checks" page, the forms, the Approvals page and the server, so a check is
 * named the same way everywhere and none can be added without saying where it lives and who approves it.
 *
 * The warehouse checks that had no approval step before (drying, a transfer lot's quality, triage) are submitted as a
 * QualitySubmission: their readings only, applied to the record on approval through the same service an Incharge's entry uses.
 */
import type { WarehouseType } from "../data/warehouseTypes.js";
import type { DryingQuality } from "./sunDrying.js";
import { dryingQualityProblem } from "./sunDrying.js";
import { transferNumberProblem, readNumber } from "./transferLot.js";

/** The parts of the app a quality check is taken in, in the order RCN goes through them. */
export type QualitySection =
  | "reception" | "unloading" | "unit_reception" | "drying" | "triage" | "transfer_lot" | "production_intake" | "production";

/** Who approves a QFS Officer's check in this section. */
export type QualityApprover = "warehouse_incharge" | "production_incharge";

export interface QualitySectionInfo {
  label: string;
  /** Where the check is taken, as the person finds it in the app. */
  where: string;
  /** Material Symbols icon. */
  icon: string;
  approver: QualityApprover;
  /** The warehouses it happens at: production and the reception of a Unit warehouse's trucks are the Central one's. */
  siteTypes: readonly WarehouseType[];
}

export const QUALITY_SECTIONS: Record<QualitySection, QualitySectionInfo> = {
  reception: { label: "Reception", where: "Reception › the truck › Quality", icon: "receipt_long", approver: "warehouse_incharge", siteTypes: ["UNIT", "CENTRAL"] },
  unloading: { label: "Unloading", where: "Reception › the truck › Unloading", icon: "move_to_inbox", approver: "warehouse_incharge", siteTypes: ["UNIT", "CENTRAL"] },
  unit_reception: { label: "Reception from Unit warehouse", where: "Reception › From Unit warehouse › the lot › Quality", icon: "local_shipping", approver: "warehouse_incharge", siteTypes: ["CENTRAL"] },
  drying: { label: "Drying", where: "Sun drying: a truck on the yard, or a Bin in Warehouse activities", icon: "wb_sunny", approver: "warehouse_incharge", siteTypes: ["UNIT", "CENTRAL"] },
  triage: { label: "Triage / cleaning", where: "Warehouse activity ledger › Triage / cleaning", icon: "filter_alt", approver: "warehouse_incharge", siteTypes: ["UNIT", "CENTRAL"] },
  transfer_lot: { label: "Transfer lot", where: "Transfers › Lots to send", icon: "inventory_2", approver: "warehouse_incharge", siteTypes: ["UNIT"] },
  production_intake: { label: "Production intake", where: "Production runs › the run › Intake › the load", icon: "conveyor_belt", approver: "warehouse_incharge", siteTypes: ["CENTRAL"] },
  production: { label: "Production", where: "Production runs › the run › its stage", icon: "precision_manufacturing", approver: "production_incharge", siteTypes: ["CENTRAL"] },
};

export const QUALITY_SECTION_ORDER: readonly QualitySection[] = ["reception", "unloading", "unit_reception", "drying", "triage", "transfer_lot", "production_intake", "production"];

export const APPROVER_LABEL: Record<QualityApprover, string> = { warehouse_incharge: "Warehouse Incharge", production_incharge: "Production Incharge" };

/** The sections a warehouse of this category has checks in. */
export const sectionsAt = (siteType: WarehouseType | string | null | undefined): QualitySection[] =>
  QUALITY_SECTION_ORDER.filter((s) => QUALITY_SECTIONS[s].siteTypes.includes(siteType as WarehouseType));

// ── The checks the QFS Officer submits as a QualitySubmission ────────────────────────────────────────────────────────────

/**
 * drying_before: the quality of a round going onto the yard, when the Incharge started it without one.
 * drying_after: the check after a round came back, with its result (passed / dry again / straight to production).
 * transfer_lot: a transfer lot's moisture, KOR and nut count, weighed without them.
 * triage: the moisture after a triage / cleaning activity recorded without it.
 */
export const QUALITY_SUBMISSION_KINDS = ["drying_before", "drying_after", "transfer_lot", "triage"] as const;
export type QualitySubmissionKind = (typeof QUALITY_SUBMISSION_KINDS)[number];
export const isQualitySubmissionKind = (k: unknown): k is QualitySubmissionKind => QUALITY_SUBMISSION_KINDS.includes(k as QualitySubmissionKind);

export const QUALITY_SUBMISSION_INFO: Record<QualitySubmissionKind, { section: QualitySection; title: string }> = {
  drying_before: { section: "drying", title: "Quality going onto the yard" },
  drying_after: { section: "drying", title: "Quality check after drying" },
  transfer_lot: { section: "transfer_lot", title: "Transfer lot quality" },
  triage: { section: "triage", title: "Moisture after triage" },
};

export type QualitySubmissionStatus = "submitted" | "approved" | "rejected";

/** One QFS check waiting for (or past) its approval, as the screens show it. */
export interface QualitySubmissionView {
  id: number;
  kind: QualitySubmissionKind;
  section: QualitySection;
  /** What it is about: "Drying round 2 of Lot LOT-…", "Transfer lot LOT-BKE-2026-0007". */
  reference: string;
  /** The record it is about: a drying round's id, a transfer lot's id, an activity entry's id. */
  targetId: string;
  warehouse: string;
  values: Record<string, string>;
  status: QualitySubmissionStatus;
  submittedBy: string | null;
  submittedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
}

const GRAM_KEYS = ["GoodKernelG", "ImmatureG", "SpottedG", "RejectionG", "VoidG", "OilG", "ShellG"] as const;
const DRYING_KEYS = ["Moisture", "NutCount", "Kor", ...GRAM_KEYS] as const;

/** The value keys each kind takes, as the drying / transfer forms already name them. */
export const QUALITY_SUBMISSION_KEYS: Record<QualitySubmissionKind, readonly string[]> = {
  drying_before: DRYING_KEYS.map((k) => `input${k}`),
  drying_after: [...DRYING_KEYS.map((k) => `output${k}`), "decision", "destinationBin", "btmNo"],
  transfer_lot: ["moisture", "kor", "nutCount"],
  triage: ["moisturePct"],
};

export const DRYING_DECISIONS = ["pass", "redry", "production"] as const;
export const DRYING_DECISION_LABELS: Record<(typeof DRYING_DECISIONS)[number], string> = {
  pass: "Passed: dry enough, into a new Bin",
  redry: "Dry it again",
  production: "Sent straight to production",
};

const num = (v: string | undefined) => {
  const s = (v ?? "").trim();
  return s === "" ? null : Number(s.replace(/\s/g, "").replace(",", "."));
};

/** A drying reading from submitted values, in the shape the drying rules check. */
export function dryingQualityOf(values: Record<string, string | undefined>, prefix: "input" | "output"): DryingQuality {
  const g = (k: string) => num(values[`${prefix}${k}`]);
  return {
    moisture: g("Moisture"), nutCount: g("NutCount"), kor: g("Kor"),
    goodKernelG: g("GoodKernelG"), immatureG: g("ImmatureG"), spottedG: g("SpottedG"), rejectionG: g("RejectionG"),
    voidG: g("VoidG"), oilG: g("OilG"), shellG: g("ShellG"),
  };
}

/**
 * Why a QFS check can't be sent as typed, or undefined: the same hard rules the Incharge's own form has (drying's
 * dryingQualityProblem, the transfer lot's number rules), so a submission never fails only at approval.
 */
export function qualitySubmissionProblem(kind: QualitySubmissionKind, values: Record<string, string | undefined>): string | undefined {
  const typed = Object.entries(values).filter(([, v]) => (v ?? "").trim() !== "");
  if (!typed.length) return "Nothing to send: enter the readings first.";
  const unknown = typed.map(([k]) => k).filter((k) => !QUALITY_SUBMISSION_KEYS[kind].includes(k));
  if (unknown.length) return `Not part of this check: ${unknown.join(", ")}.`;
  const notNumber = typed.filter(([k, v]) => !["decision", "destinationBin", "btmNo"].includes(k) && Number.isNaN(num(v)));
  if (notNumber.length) return `Must be a number: ${notNumber.map(([k]) => k).join(", ")}.`;
  switch (kind) {
    case "drying_before":
      return dryingQualityProblem(dryingQualityOf(values, "input"), "before") ?? undefined;
    case "drying_after": {
      if (!DRYING_DECISIONS.includes(values.decision as never)) return "Choose the result of the check: passed, dry it again, or sent straight to production.";
      return dryingQualityProblem(dryingQualityOf(values, "output"), "after") ?? undefined;
    }
    case "transfer_lot": {
      const out = (["moisture", "kor", "nutCount"] as const)
        .map((k) => [k, transferNumberProblem(k, values[k], true)] as const)
        .filter(([, p]) => p && !p.soft);
      return out.length ? out.map(([k, p]) => `${k === "nutCount" ? "Nut count" : k === "kor" ? "KOR" : "Moisture"}: ${p!.message}`).join(" ") : undefined;
    }
    case "triage": {
      const m = readNumber(values.moisturePct);
      return m === null || m < 0 || m > 100 ? "Moisture after triage: enter it, between 0 and 100 %." : undefined;
    }
  }
}

// ── The QFS Officer's list ───────────────────────────────────────────────────────────────────────────────────────────────

/** Where a check is filled: a page the app already has, or the form on the Quality checks page itself. */
export type QualityCheckLink =
  | { kind: "receipt"; receiptId: string; stageId: string }
  | { kind: "run"; runCode: string; stage: string; loadId?: string }
  | { kind: "form"; submissionKind: QualitySubmissionKind; targetId: string };

/**
 * One line of the QFS Officer's list: a check still to take, or one of theirs waiting for approval or rejected. `missing`
 * names what is still to be measured, by the label the form shows.
 */
export interface QualityCheckItem {
  key: string;
  section: QualitySection;
  title: string;
  /** What it is about, in the IDs people use: a truck (REC-…), Lot, Bin, BKT, run, load. */
  reference: string;
  /** One line of what is known already: the weights, the reading before drying… */
  context?: string;
  missing: string[];
  state: "to_do" | "waiting_approval" | "rejected";
  /** For "rejected": why. */
  note?: string;
  warehouse: string;
  /** ISO: since when it has been due, or sent. */
  since: string | null;
  link: QualityCheckLink;
  /** The values a "form" check starts from: a drying round's reading before, the weight of a transfer lot. */
  facts?: Record<string, string>;
}

export interface QualityChecksView {
  warehouse: string;
  siteType: WarehouseType | null;
  sections: QualitySection[];
  items: QualityCheckItem[];
}

/** To do first, then what is waiting; inside each, by the order RCN goes through the sections, oldest first. */
export function sortQualityItems(items: readonly QualityCheckItem[]): QualityCheckItem[] {
  const stateRank = { rejected: 0, to_do: 1, waiting_approval: 2 } as const;
  return [...items].sort((a, b) =>
    stateRank[a.state] - stateRank[b.state]
    || QUALITY_SECTION_ORDER.indexOf(a.section) - QUALITY_SECTION_ORDER.indexOf(b.section)
    || (a.since ?? "").localeCompare(b.since ?? ""));
}

/**
 * The section a reception form's submission is from: a lot from the Unit warehouse's reception, the bag check alone (Unloading),
 * or the truck's quality (Reception). The QFS Officer's list and the Approvals page name it the same way.
 */
export function formSubmissionSection(stageIds: readonly string[], fromTransfer: boolean): QualitySection {
  if (fromTransfer) return "unit_reception";
  return stageIds.length > 0 && stageIds.every((s) => s === "n-unload") ? "unloading" : "reception";
}
