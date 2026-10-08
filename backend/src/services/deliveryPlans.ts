/**
 * Delivery Plans — what is expected to arrive, recorded before the truck comes (Oct 2026 team
 * feedback, then the client's APPLICATION VIEW workbook). One plan can cover several trucks; a truck
 * may also arrive with no plan at all (see services/receiptPlanInfo.ts for how that is flagged).
 * Arriving against a plan copies its supplier and warehouse onto the receipt (services/receipts.ts's
 * createReceipt), so neither is typed twice.
 *
 * Everything that describes what actually arrived — received kg, arrivals, accepted trucks,
 * remaining, variance, status — is DERIVED from the linked receipts here and never stored, so a
 * plan can't disagree with its own trucks. The one stored state is a person's decision to cancel.
 */
import { Prisma } from "@prisma/client";
import { yearOf } from "@anagroci/contract/domain/ids";
import { isOverdue, planProgress, planStatus } from "@anagroci/contract/domain/deliveryPlan";
import type { DeliveryPlan } from "@anagroci/contract/types/receipt";
import { parseQty } from "@anagroci/contract/domain/receiptMath";
import { prisma } from "../db.js";
import { ValidationError } from "../domain/validation.js";
import { nextDeliveryPlanId, siteOf } from "./ids.js";
import { PLAN_FACTS_SELECT, toFacts, toTerms } from "./planFacts.js";

export interface DeliveryPlanInput {
  plannedDeliveryDate?: string | null;
  supplierName?: string;
  supplierCode?: string | null;
  expectedQuantityKg?: string | number | null;
  expectedTruckType?: string | null;
  expectedTrucks?: string | number | null;
  expectedOrigin?: string | null;
  expectedArrivalDate?: string;
  expectedDeliveryEnd?: string | null;
  destinationWarehouse?: string;
  destinationStore?: string | null;
  fundingReference?: string | null;
  planningBasis?: string | null;
  remarks?: string | null;
  /** true cancels the plan (a reason is required); false reinstates it. */
  cancelled?: boolean;
  cancelReason?: string | null;
}

// The truck number is typed on the Gate stage; the receipt's own column only mirrors it after an
// approved submission or a workbook edit, so PLAN_FACTS_SELECT reads the stage and the column.
const INCLUDE = {
  receipts: { select: PLAN_FACTS_SELECT, orderBy: [{ arrivalDate: "asc" }, { id: "asc" }] },
} as const satisfies Prisma.DeliveryPlanInclude;

type PlanRow = Prisma.DeliveryPlanGetPayload<{ include: typeof INCLUDE }>;

export function toWire(p: PlanRow, today: string): DeliveryPlan {
  const terms = toTerms(p);
  const progress = planProgress(terms, p.receipts.map(toFacts));
  const status = planStatus(terms, progress);
  const first = p.receipts[0];
  return {
    id: p.id,
    plannedDeliveryDate: p.plannedDeliveryDate,
    supplierName: p.supplierName,
    supplierCode: p.supplierCode,
    expectedQuantityKg: terms.expectedQuantityKg,
    expectedTruckType: p.expectedTruckType,
    expectedTrucks: p.expectedTrucks,
    expectedOrigin: p.expectedOrigin,
    expectedArrivalDate: p.expectedArrivalDate,
    expectedDeliveryEnd: p.expectedDeliveryEnd,
    destinationWarehouse: p.destinationWarehouse,
    destinationStore: p.destinationStore,
    fundingReference: p.fundingReference,
    remarks: p.remarks,
    planningBasis: p.planningBasis,
    cancelledAt: p.cancelledAt?.toISOString() ?? null,
    cancelReason: p.cancelReason,
    status,
    overdue: isOverdue(terms, status, today),
    progress,
    actualArrivalDate: first?.arrivalDate ?? null,
    truckNos: p.receipts.map((r) => r.gate?.vehicleNo?.trim() || r.vehicleNo).filter(Boolean),
    receiptIds: p.receipts.map((r) => r.id),
  };
}

const today = () => new Date().toISOString().slice(0, 10);

/** `site` is a resolved list of names (domain/site.ts's resolveSite), as every scoped list takes. */
export async function listDeliveryPlans(site?: string[], db: Prisma.TransactionClient | typeof prisma = prisma) {
  const rows = await db.deliveryPlan.findMany({
    where: site ? { destinationWarehouse: { in: site } } : {},
    include: INCLUDE,
    orderBy: [{ expectedArrivalDate: "asc" }, { id: "asc" }],
  });
  const t = today();
  return rows.map((r) => toWire(r, t));
}

export async function getDeliveryPlan(id: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const row = await db.deliveryPlan.findUnique({ where: { id }, include: INCLUDE });
  return row ? toWire(row, today()) : null;
}

function quantity(v: DeliveryPlanInput["expectedQuantityKg"]): Prisma.Decimal | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = parseQty(v);
  if (n === undefined || n < 0) throw new ValidationError(`Expected quantity "${v}" isn't a number of kg.`);
  return new Prisma.Decimal(n);
}

function trucks(v: DeliveryPlanInput["expectedTrucks"]): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).trim());
  if (!Number.isInteger(n) || n < 1) throw new ValidationError(`Expected trucks "${v}" isn't a whole number of trucks.`);
  return n;
}

const text = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);

function windowEnd(start: string, end: string | null | undefined): string | null {
  const e = text(end);
  if (e === null) return null;
  if (yearOf(e) === undefined) throw new ValidationError("The end of the delivery window must be YYYY-MM-DD.");
  if (e < start) throw new ValidationError("The delivery window ends before it starts.");
  return e;
}

/** The store has to be one of the destination site's own stores — a plan can't point at another site's shelf. */
async function checkStore(tx: Prisma.TransactionClient, site: string, store: string | null) {
  if (store === null) return;
  const row = await tx.warehouse.findUnique({ where: { name: store }, select: { site: true } });
  if (!row || row.site !== site) throw new ValidationError(`"${store}" isn't a store of ${site}.`);
}

export async function createDeliveryPlan(input: DeliveryPlanInput) {
  const supplierName = input.supplierName?.trim();
  const expectedArrivalDate = input.expectedArrivalDate?.trim();
  const destination = input.destinationWarehouse?.trim();
  if (!supplierName) throw new ValidationError("A delivery plan needs a supplier.");
  if (!expectedArrivalDate || yearOf(expectedArrivalDate) === undefined) throw new ValidationError("A delivery plan needs an expected arrival date (YYYY-MM-DD).");
  if (!destination) throw new ValidationError("A delivery plan needs a destination warehouse.");
  const end = windowEnd(expectedArrivalDate, input.expectedDeliveryEnd);

  const row = await prisma.$transaction(async (tx) => {
    // Plans are filed under the SITE, like receipts, whichever of its names was picked.
    const site = await siteOf(tx, destination);
    if (!site) throw new ValidationError(`Warehouse "${destination}" isn't in the warehouse master.`);
    const store = text(input.destinationStore);
    await checkStore(tx, site, store);
    const id = await nextDeliveryPlanId(tx, site, expectedArrivalDate);
    await tx.deliveryPlan.create({
      data: {
        id,
        plannedDeliveryDate: text(input.plannedDeliveryDate),
        supplierName,
        supplierCode: text(input.supplierCode),
        expectedQuantityKg: quantity(input.expectedQuantityKg),
        expectedTruckType: text(input.expectedTruckType),
        expectedTrucks: trucks(input.expectedTrucks),
        expectedOrigin: text(input.expectedOrigin),
        expectedArrivalDate,
        expectedDeliveryEnd: end,
        destinationWarehouse: site,
        destinationStore: store,
        fundingReference: text(input.fundingReference),
        planningBasis: text(input.planningBasis),
        remarks: text(input.remarks),
      },
    });
    return tx.deliveryPlan.findUniqueOrThrow({ where: { id }, include: INCLUDE });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return toWire(row, today());
}

/**
 * Everything the plan says about the expected delivery can be corrected. The destination warehouse
 * can't: its code is printed in the plan's own ID. `actorId` is who cancels, when someone does.
 */
export async function updateDeliveryPlan(id: string, patch: DeliveryPlanInput, actorId?: string) {
  const existing = await prisma.deliveryPlan.findUnique({ where: { id } });
  if (!existing) throw Object.assign(new Error("Delivery plan not found"), { code: "P2025" });
  if (patch.destinationWarehouse !== undefined && patch.destinationWarehouse.trim() !== existing.destinationWarehouse) {
    throw new ValidationError("The destination warehouse is part of the plan's ID and can't be changed — create a new plan instead.");
  }
  const data: Prisma.DeliveryPlanUncheckedUpdateInput = {};
  if (patch.supplierName !== undefined) {
    if (!patch.supplierName.trim()) throw new ValidationError("A delivery plan needs a supplier.");
    data.supplierName = patch.supplierName.trim();
  }
  const start = patch.expectedArrivalDate !== undefined ? patch.expectedArrivalDate.trim() : existing.expectedArrivalDate;
  if (patch.expectedArrivalDate !== undefined) {
    if (yearOf(start) === undefined) throw new ValidationError("The expected arrival date must be YYYY-MM-DD.");
    data.expectedArrivalDate = start;
  }
  // The window is re-checked whenever either end moves, against the other end as it will be saved.
  if (patch.expectedDeliveryEnd !== undefined || patch.expectedArrivalDate !== undefined) {
    data.expectedDeliveryEnd = windowEnd(start, patch.expectedDeliveryEnd !== undefined ? patch.expectedDeliveryEnd : existing.expectedDeliveryEnd);
  }
  if (patch.plannedDeliveryDate !== undefined) data.plannedDeliveryDate = text(patch.plannedDeliveryDate);
  if (patch.supplierCode !== undefined) data.supplierCode = text(patch.supplierCode);
  if (patch.expectedQuantityKg !== undefined) data.expectedQuantityKg = quantity(patch.expectedQuantityKg);
  if (patch.expectedTruckType !== undefined) data.expectedTruckType = text(patch.expectedTruckType);
  if (patch.expectedTrucks !== undefined) data.expectedTrucks = trucks(patch.expectedTrucks);
  if (patch.expectedOrigin !== undefined) data.expectedOrigin = text(patch.expectedOrigin);
  if (patch.fundingReference !== undefined) data.fundingReference = text(patch.fundingReference);
  if (patch.planningBasis !== undefined) data.planningBasis = text(patch.planningBasis);
  if (patch.remarks !== undefined) data.remarks = text(patch.remarks);
  if (patch.destinationStore !== undefined) {
    const store = text(patch.destinationStore);
    await checkStore(prisma, existing.destinationWarehouse, store);
    data.destinationStore = store;
  }
  if (patch.cancelled === true) {
    const reason = text(patch.cancelReason);
    if (!reason) throw new ValidationError("Say why the plan is cancelled.");
    if (!existing.cancelledAt) {
      data.cancelledAt = new Date();
      data.cancelledBy = actorId ?? null;
    }
    data.cancelReason = reason;
  } else if (patch.cancelled === false) {
    data.cancelledAt = null;
    data.cancelledBy = null;
    data.cancelReason = null;
  }
  const row = await prisma.deliveryPlan.update({ where: { id }, data, include: INCLUDE });
  return toWire(row, today());
}
