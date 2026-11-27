/**
 * A live quality request (27 Nov 2026, user): the moment the Warehouse Incharge or an Admin opens a drying form that needs
 * the QFS Officer's quality, the QFS Officer is asked for it, without the Incharge saving an empty form first. The request
 * stays until the Incharge clicks Cancel on the form (user, 27 Nov 2026): leaving the page or closing the tab does not
 * cancel it, and coming back opens the form again.
 *
 * The QFS Officer's readings always go to Approvals first (user, 27 Nov 2026). Only an approved reading fills the form:
 *
 * - drying_before: the round doesn't exist while the form is open, so the readings are a check of the request itself.
 *   Approved, they fill the Incharge's open form; rejected, the check is the QFS Officer's to do again. If the Incharge starts
 *   the round while the check still waits, it becomes that round's check. Cancelling the form withdraws a check still
 *   waiting, and the QFS Officer sees it as cancelled.
 * - drying_after: the round exists, so the readings are the round's check in Approvals, and approving it records the check.
 *   Cancelling the form leaves that check in Approvals: nothing measured is lost.
 */

export const QUALITY_REQUEST_KINDS = ["drying_before", "drying_after"] as const;
export type QualityRequestKind = (typeof QUALITY_REQUEST_KINDS)[number];
export const isQualityRequestKind = (k: unknown): k is QualityRequestKind => QUALITY_REQUEST_KINDS.includes(k as QualityRequestKind);

/**
 * open: the form is open, waiting for the QFS Officer's reading (or its approval). answered: before drying, the reading was
 * approved and fills the form. used: the form was saved. cancelled: the Incharge clicked Cancel.
 */
export const QUALITY_REQUEST_STATUSES = ["open", "answered", "used", "cancelled"] as const;
export type QualityRequestStatus = (typeof QUALITY_REQUEST_STATUSES)[number];
/** The form is still open: the QFS Officer's list shows it, and the page opens the form again. */
export const isLiveRequest = (s: string) => s === "open" || s === "answered";

/**
 * What the form is about. drying_before: the truck or Bin the round will be issued from (it has no id yet).
 * drying_after: the round being checked.
 */
export type QualityRequestScope =
  | { kind: "receipt"; receiptId: string }
  | { kind: "bin"; binCode: string }
  | { kind: "round"; roundId: string };

/** The scope as one stored string, so "one live request per form" is a plain lookup. */
export function scopeKey(s: QualityRequestScope): string {
  switch (s.kind) {
    case "receipt": return `receipt:${s.receiptId}`;
    case "bin": return `bin:${s.binCode.trim().toUpperCase()}`;
    case "round": return `round:${s.roundId}`;
  }
}

export function parseScope(key: string): QualityRequestScope | null {
  const i = key.indexOf(":");
  const kind = key.slice(0, i);
  const id = key.slice(i + 1);
  if (!id) return null;
  if (kind === "receipt") return { kind, receiptId: id };
  if (kind === "bin") return { kind, binCode: id };
  if (kind === "round") return { kind, roundId: id };
  return null;
}

/** The scope a kind's form has: a round only after drying. */
export const scopeFitsKind = (kind: QualityRequestKind, s: QualityRequestScope) => (kind === "drying_after") === (s.kind === "round");

/** A check before drying is about the request until the round exists: its QualitySubmission targets "request:<id>". */
export const requestTargetId = (id: number) => `request:${id}`;
export const requestIdOfTarget = (targetId: string): number | null => {
  const m = /^request:(\d+)$/.exec(targetId);
  return m ? Number(m[1]) : null;
};

/** A request as the Incharge's open form and the QFS Officer's list read it. */
export interface QualityRequestView {
  id: number;
  kind: QualityRequestKind;
  scope: QualityRequestScope;
  warehouse: string;
  /** What it is about, as people name it: "Truck REC-… · Lot …", "Drying from Bin BKE-BIN-08", "Drying round 2 of Lot …". */
  reference: string;
  status: QualityRequestStatus;
  openedBy: string | null;
  openedAt: string;
  /** drying_before: the QFS Officer's reading once approved, which fills the form. */
  values: Record<string, string> | null;
  answeredBy: string | null;
  answeredAt: string | null;
  /** The round the form started (once used). */
  roundId: string | null;
}

/** Why a check waiting for approval was withdrawn, for the QFS Officer who sent it. */
export const CANCELLED_NOTE = "The Warehouse Incharge cancelled the drying form, so this check is no longer needed.";
