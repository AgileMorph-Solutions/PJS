/**
 * Delivery Plan arithmetic — what a pre-alert says should arrive versus what did. Pure functions, so
 * the backend (which serves it) and the frontend (which shows it) can never disagree.
 *
 * Everything here is DERIVED from the plan's terms and the receipts linked to it. Nothing is stored
 * except the one decision a person makes: cancelling a plan. The client's APPLICATION VIEW workbook
 * types "Plan Status" by hand and it already disagrees with its own arrivals (a CANCELLED plan with
 * three arrivals; a DELIVERED one 13,891 kg over plan) — the same drift the repo's "one source of
 * truth per fact" rule exists to prevent.
 *
 * "Actual received" is the GRN quantity — the quantity officially recognised into stock — exactly as
 * the client's own SUMIFS over their GRN Quantity column. A truck whose GRN isn't recorded yet counts
 * as an arrival but adds no quantity.
 */

/** The terms the plan was made with — the columns of the client's Delivery Plan sheet. */
export interface PlanTerms {
  expectedQuantityKg: number | null;
  expectedTrucks: number | null;
  /** First day of the expected delivery window (the plan's `expectedArrivalDate`). */
  expectedArrivalDate: string;
  expectedDeliveryEnd: string | null;
  expectedOrigin: string | null;
  /** The store inside the destination site where the goods are expected, e.g. BKE-003. */
  destinationStore: string | null;
  cancelled: boolean;
}

/** What the plan needs to know about one truck that arrived against it. */
export interface PlanReceiptFacts {
  id: string;
  arrivalDate: string;
  rejected: boolean;
  /** Undefined until the GRN quantity is recorded. */
  grnKg?: number;
  origin?: string;
  store?: string;
}

export interface PlanProgress {
  /** Sum of GRN quantity over every linked truck that has one. */
  actualKg: number;
  /** Every truck recorded against the plan, accepted or rejected. */
  arrivals: number;
  acceptedTrucks: number;
  /** Failed quality. Always arrivals − acceptedTrucks; carried so every screen says it the same way. */
  rejectedTrucks: number;
  /** Accepted but no GRN yet: on site, adding no kg. */
  awaitingGrnTrucks: number;
  /** expected − actual; negative once the plan is over-delivered. Null when no quantity was planned. */
  remainingKg: number | null;
  /** actual − expected: positive means more arrived than planned. Null when no quantity was planned. */
  varianceKg: number | null;
}

export type PlanStatus = "planned" | "partially_received" | "delivered" | "cancelled";

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  planned: "Planned",
  partially_received: "Partially received",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/** Trucks in arrival order, ties by id — the order "what had already arrived before this one" is judged in. */
const byArrival = (a: PlanReceiptFacts, b: PlanReceiptFacts) => a.arrivalDate.localeCompare(b.arrivalDate) || a.id.localeCompare(b.id);

export function planProgress(plan: Pick<PlanTerms, "expectedQuantityKg">, receipts: PlanReceiptFacts[]): PlanProgress {
  const actualKg = receipts.reduce((sum, r) => sum + (r.grnKg ?? 0), 0);
  const expected = plan.expectedQuantityKg;
  return {
    actualKg,
    arrivals: receipts.length,
    acceptedTrucks: receipts.filter((r) => !r.rejected).length,
    rejectedTrucks: receipts.filter((r) => r.rejected).length,
    awaitingGrnTrucks: receipts.filter((r) => !r.rejected && r.grnKg === undefined).length,
    remainingKg: expected === null ? null : expected - actualKg,
    varianceKg: expected === null ? null : actualKg - expected,
  };
}

/**
 * Cancelled is the one stored state. Otherwise a plan is delivered once the trucks it expected, or
 * the quantity it expected, have arrived; partially received once anything has; planned before that.
 * Whether it is late is separate (`isOverdue`) — a half-delivered plan past its window is both, and
 * hiding either fact behind a single label loses information.
 */
export function planStatus(plan: PlanTerms, progress: PlanProgress): PlanStatus {
  if (plan.cancelled) return "cancelled";
  const trucksIn = plan.expectedTrucks !== null && progress.arrivals >= plan.expectedTrucks;
  const kgIn = plan.expectedQuantityKg !== null && progress.actualKg >= plan.expectedQuantityKg;
  if (progress.arrivals > 0 && (trucksIn || kgIn)) return "delivered";
  return progress.arrivals > 0 ? "partially_received" : "planned";
}

/** Past the end of the window (or its start, when no end was given) and not yet delivered or cancelled. */
export function isOverdue(plan: PlanTerms, status: PlanStatus, today: string): boolean {
  if (status === "delivered" || status === "cancelled") return false;
  return today > (plan.expectedDeliveryEnd ?? plan.expectedArrivalDate);
}

// ── Per-truck: planned, planned with exception, or unplanned ─────────────────────────────────

export type ReceptionType = "planned" | "planned_with_exception" | "unplanned";

export type PlanFlag =
  | "unplanned"
  | "unknown_supplier"
  | "quality_rejected"
  | "origin_mismatch"
  | "warehouse_change"
  | "early_delivery"
  | "late_delivery"
  | "plan_excess"
  | "plan_cancelled";

export const PLAN_FLAG_LABELS: Record<PlanFlag, string> = {
  unplanned: "Unplanned",
  unknown_supplier: "Supplier not in master",
  quality_rejected: "Quality rejected",
  origin_mismatch: "Origin differs from plan",
  warehouse_change: "Different store than planned",
  early_delivery: "Early delivery",
  late_delivery: "Late delivery",
  plan_excess: "Over the planned quantity",
  plan_cancelled: "Plan cancelled — arrival recorded",
};

/** A rejection is a quality outcome, not a departure from the plan, so it never makes a planned truck an exception. */
const EXCEPTION_FLAGS: ReadonlySet<PlanFlag> = new Set<PlanFlag>([
  "origin_mismatch", "warehouse_change", "early_delivery", "late_delivery", "plan_excess", "plan_cancelled",
]);

export interface ReceptionPlanInfo {
  type: ReceptionType;
  flags: PlanFlag[];
}

const same = (a: string | undefined | null, b: string | undefined | null) => (a ?? "").trim().toUpperCase() === (b ?? "").trim().toUpperCase();

/** A truck with no plan. `knownSupplier: false` only when the caller checked the master and it isn't there. */
export function unplannedInfo(receipt: Pick<PlanReceiptFacts, "rejected">, opts: { knownSupplier?: boolean } = {}): ReceptionPlanInfo {
  const flags: PlanFlag[] = ["unplanned"];
  if (opts.knownSupplier === false) flags.push("unknown_supplier");
  if (receipt.rejected) flags.push("quality_rejected");
  return { type: "unplanned", flags };
}

/**
 * Every truck linked to one plan, judged in arrival order so "over the planned quantity" lands on
 * the truck that crossed the line rather than on all of them. Origin and store are compared only
 * when BOTH sides are known — a blank is "not recorded", never a mismatch.
 */
export function plannedReceptionInfo(plan: PlanTerms, receipts: PlanReceiptFacts[]): Map<string, ReceptionPlanInfo> {
  const out = new Map<string, ReceptionPlanInfo>();
  let received = 0;
  for (const r of [...receipts].sort(byArrival)) {
    const flags: PlanFlag[] = [];
    if (plan.cancelled) flags.push("plan_cancelled");
    if (plan.expectedOrigin && r.origin && !same(plan.expectedOrigin, r.origin)) flags.push("origin_mismatch");
    if (plan.destinationStore && r.store && !same(plan.destinationStore, r.store)) flags.push("warehouse_change");
    if (r.arrivalDate < plan.expectedArrivalDate) flags.push("early_delivery");
    if (plan.expectedDeliveryEnd && r.arrivalDate > plan.expectedDeliveryEnd) flags.push("late_delivery");
    const before = received;
    received += r.grnKg ?? 0;
    if (plan.expectedQuantityKg !== null && r.grnKg !== undefined && before + r.grnKg > plan.expectedQuantityKg && before <= plan.expectedQuantityKg) {
      flags.push("plan_excess");
    }
    if (r.rejected) flags.push("quality_rejected");
    out.set(r.id, { type: flags.some((f) => EXCEPTION_FLAGS.has(f)) ? "planned_with_exception" : "planned", flags });
  }
  return out;
}

// ── Approval and how the truck came to be linked ─────────────────────────────────────────────

export type ExceptionApproval = "not_required" | "pending" | "approved" | "not_applicable_rejected";

/**
 * A rejected truck never needs approval (nothing enters stock). Otherwise only departures from the
 * plan do, and they need one recorded decision. Approval never blocks the reception itself.
 */
export function exceptionApprovalStatus(info: ReceptionPlanInfo, rejected: boolean, approvedAt: string | null | undefined): ExceptionApproval {
  if (rejected) return "not_applicable_rejected";
  if (info.type === "planned") return "not_required";
  return approvedAt ? "approved" : "pending";
}

export type PlanLinkStatus = "not_planned" | "planned_from_start" | "linked_later";

/** `linkedLaterAt` is set only when the plan was attached after the receipt already existed. */
export function planLinkStatus(deliveryPlanId: string | null | undefined, linkedLaterAt: string | null | undefined): PlanLinkStatus {
  if (!deliveryPlanId) return "not_planned";
  return linkedLaterAt ? "linked_later" : "planned_from_start";
}

// ── What a truck arriving against a plan already knows ───────────────────────────────────────

export interface PlanPrefillSource {
  supplierName: string;
  supplierCode: string | null;
  expectedOrigin: string | null;
  destinationStore: string | null;
}

/** The stage fields a plan can fill, as [stageId, label, which plan field]. */
const PLAN_PREFILL: readonly (readonly [stageId: string, label: string, from: keyof PlanPrefillSource])[] = [
  ["n-verify", "SUPPLIERS NAME", "supplierName"],
  ["n-verify", "LBA CODE", "supplierCode"],
  ["n-verify", "ORIGIN", "expectedOrigin"],
  ["n-gate", "WH NO.", "destinationStore"],
];

/**
 * Suggestions for the EMPTY fields of one stage from the plan the truck arrived against — so what the
 * pre-alert already said is not typed again at the gate. A suggestion, never a write: picking one
 * is the person confirming the truck really matches the plan (it may not — that is what the
 * exception flags are for).
 */
export function planPrefill(
  plan: PlanPrefillSource | undefined,
  stageData: Record<string, Record<string, string>>,
  stageId: string
): Record<string, { value: string; from: string }> {
  const out: Record<string, { value: string; from: string }> = {};
  if (!plan) return out;
  for (const [stage, label, field] of PLAN_PREFILL) {
    if (stage !== stageId) continue;
    const value = plan[field]?.trim();
    if (value && (stageData[stageId]?.[label] ?? "").trim() === "") out[label] = { value, from: "delivery plan" };
  }
  return out;
}

// ── Words for the workbook and the screens (one place, so a column and a badge never disagree) ──

export const RECEPTION_TYPE_LABELS: Record<ReceptionType, string> = {
  planned: "Planned",
  planned_with_exception: "Planned with exception",
  unplanned: "Unplanned",
};

export const EXCEPTION_APPROVAL_LABELS: Record<ExceptionApproval, string> = {
  not_required: "Not required",
  pending: "Pending",
  approved: "Approved",
  not_applicable_rejected: "N/A - rejected",
};

export const PLAN_LINK_LABELS: Record<PlanLinkStatus, string> = {
  not_planned: "Not planned",
  planned_from_start: "Planned from start",
  linked_later: "Linked afterwards",
};
