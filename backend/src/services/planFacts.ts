/**
 * What a Delivery Plan needs to know about the trucks that arrived against it, read out of the
 * database once so the plan view (services/deliveryPlans.ts) and the per-receipt view
 * (services/receiptPlanInfo.ts) judge the same facts the same way.
 *
 * GRN quantity is the "actual received" — the quantity officially recognised into stock — so a truck
 * whose GRN isn't recorded yet is an arrival that adds no kg (see contract domain/deliveryPlan.ts).
 */
import type { Prisma } from "@prisma/client";
import type { PlanReceiptFacts, PlanTerms } from "@anagroci/contract/domain/deliveryPlan";

/** The receipt columns and stage rows the plan arithmetic reads — and nothing else. */
export const PLAN_FACTS_SELECT = {
  id: true,
  arrivalDate: true,
  vehicleNo: true,
  origin: true,
  deliveryPlanId: true,
  gate: { select: { vehicleNo: true, whNo: true } },
  verify: { select: { origin: true } },
  grn: { select: { grnWeightNum: true } },
  branches: { where: { stageId: "n-qfs" }, select: { branchId: true } },
} as const satisfies Prisma.ReceiptSelect;

export type PlanFactsRow = Prisma.ReceiptGetPayload<{ select: typeof PLAN_FACTS_SELECT }>;

const clean = (v: string | null | undefined) => (v?.trim() ? v.trim() : undefined);

export function toFacts(r: PlanFactsRow): PlanReceiptFacts {
  const grn = r.grn?.grnWeightNum;
  return {
    id: r.id,
    arrivalDate: r.arrivalDate,
    rejected: r.branches.some((b) => b.branchId === "fail"),
    grnKg: grn === null || grn === undefined ? undefined : Number(grn),
    // The stage value is what the person typed at the gate/verify step; the receipt's own column only mirrors it.
    origin: clean(r.verify?.origin) ?? clean(r.origin),
    store: clean(r.gate?.whNo),
  };
}

export function toTerms(p: {
  expectedQuantityKg: Prisma.Decimal | null; expectedTrucks: number | null; expectedArrivalDate: string; expectedDeliveryEnd: string | null;
  expectedOrigin: string | null; destinationStore: string | null; cancelledAt: Date | null;
}): PlanTerms {
  return {
    expectedQuantityKg: p.expectedQuantityKg === null ? null : Number(p.expectedQuantityKg),
    expectedTrucks: p.expectedTrucks,
    expectedArrivalDate: p.expectedArrivalDate,
    expectedDeliveryEnd: p.expectedDeliveryEnd,
    expectedOrigin: p.expectedOrigin,
    destinationStore: p.destinationStore,
    cancelled: p.cancelledAt !== null,
  };
}
