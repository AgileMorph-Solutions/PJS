/**
 * Delivery Plans — what is expected to arrive, recorded before the truck comes (Oct 2026 team
 * feedback). A truck may arrive with or without one; arriving against a plan copies its supplier
 * and warehouse onto the receipt (services/receipts.ts's createReceipt), so neither is typed twice.
 *
 * The client's sheet also has "actual arrival date", "delivery status" and "truck no" columns.
 * Those describe the truck that came, so they are read from the linked receipt here rather than
 * stored on the plan, where they could disagree with it.
 */
import { Prisma } from "@prisma/client";
import { yearOf } from "@anagroci/contract/domain/ids";
import type { DeliveryPlan, DeliveryStatus } from "@anagroci/contract/types/receipt";
import { parseQty } from "@anagroci/contract/domain/receiptMath";
import { prisma } from "../db.js";
import { ValidationError } from "../domain/validation.js";
import { nextDeliveryPlanId, siteOf } from "./ids.js";

export interface DeliveryPlanInput {
  plannedDeliveryDate?: string | null;
  supplierName?: string;
  supplierCode?: string | null;
  expectedQuantityKg?: string | number | null;
  expectedTruckType?: string | null;
  expectedArrivalDate?: string;
  destinationWarehouse?: string;
  remarks?: string | null;
}

// The truck number is typed on the Gate stage; the receipt's own column only mirrors it after an
// approved submission or a workbook edit, so read the stage first and fall back to the column.
const INCLUDE = {
  receipts: { select: { id: true, arrivalDate: true, vehicleNo: true, gate: { select: { vehicleNo: true } } }, orderBy: { arrivalDate: "asc" } },
} as const;

type PlanRow = Prisma.DeliveryPlanGetPayload<{ include: typeof INCLUDE }>;

function toWire(p: PlanRow, today: string): DeliveryPlan {
  const first = p.receipts[0];
  const deliveryStatus: DeliveryStatus = first ? "arrived" : p.expectedArrivalDate < today ? "overdue" : "planned";
  return {
    id: p.id,
    plannedDeliveryDate: p.plannedDeliveryDate,
    supplierName: p.supplierName,
    supplierCode: p.supplierCode,
    expectedQuantityKg: p.expectedQuantityKg === null ? null : Number(p.expectedQuantityKg),
    expectedTruckType: p.expectedTruckType,
    expectedArrivalDate: p.expectedArrivalDate,
    destinationWarehouse: p.destinationWarehouse,
    remarks: p.remarks,
    // Derived from the receipt(s) that arrived against this plan — see the file header.
    deliveryStatus,
    actualArrivalDate: first?.arrivalDate ?? null,
    truckNo: first?.gate?.vehicleNo?.trim() || first?.vehicleNo || null,
    receiptIds: p.receipts.map((r) => r.id),
  };
}

const today = () => new Date().toISOString().slice(0, 10);

/** `site` is a resolved list of names (domain/site.ts's resolveSite), as every scoped list takes. */
export async function listDeliveryPlans(site?: string[]) {
  const rows = await prisma.deliveryPlan.findMany({
    where: site ? { destinationWarehouse: { in: site } } : {},
    include: INCLUDE,
    orderBy: [{ expectedArrivalDate: "asc" }, { id: "asc" }],
  });
  const t = today();
  return rows.map((r) => toWire(r, t));
}

export async function getDeliveryPlan(id: string) {
  const row = await prisma.deliveryPlan.findUnique({ where: { id }, include: INCLUDE });
  return row ? toWire(row, today()) : null;
}

function quantity(v: DeliveryPlanInput["expectedQuantityKg"]): Prisma.Decimal | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = parseQty(v);
  if (n === undefined || n < 0) throw new ValidationError(`Expected quantity "${v}" isn't a number of kg.`);
  return new Prisma.Decimal(n);
}

const text = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);

export async function createDeliveryPlan(input: DeliveryPlanInput) {
  const supplierName = input.supplierName?.trim();
  const expectedArrivalDate = input.expectedArrivalDate?.trim();
  const destination = input.destinationWarehouse?.trim();
  if (!supplierName) throw new ValidationError("A delivery plan needs a supplier.");
  if (!expectedArrivalDate || yearOf(expectedArrivalDate) === undefined) throw new ValidationError("A delivery plan needs an expected arrival date (YYYY-MM-DD).");
  if (!destination) throw new ValidationError("A delivery plan needs a destination warehouse.");

  const row = await prisma.$transaction(async (tx) => {
    // Plans are filed under the SITE, like receipts, whichever of its names was picked.
    const site = await siteOf(tx, destination);
    if (!site) throw new ValidationError(`Warehouse "${destination}" isn't in the warehouse master.`);
    const id = await nextDeliveryPlanId(tx, site, expectedArrivalDate);
    await tx.deliveryPlan.create({
      data: {
        id,
        plannedDeliveryDate: text(input.plannedDeliveryDate),
        supplierName,
        supplierCode: text(input.supplierCode),
        expectedQuantityKg: quantity(input.expectedQuantityKg),
        expectedTruckType: text(input.expectedTruckType),
        expectedArrivalDate,
        destinationWarehouse: site,
        remarks: text(input.remarks),
      },
    });
    return tx.deliveryPlan.findUniqueOrThrow({ where: { id }, include: INCLUDE });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return toWire(row, today());
}

/**
 * Everything the plan says about the expected delivery can be corrected. The destination warehouse
 * can't: its code is printed in the plan's own ID.
 */
export async function updateDeliveryPlan(id: string, patch: DeliveryPlanInput) {
  const existing = await prisma.deliveryPlan.findUnique({ where: { id } });
  if (!existing) throw Object.assign(new Error("Delivery plan not found"), { code: "P2025" });
  if (patch.destinationWarehouse !== undefined && patch.destinationWarehouse.trim() !== existing.destinationWarehouse) {
    throw new ValidationError("The destination warehouse is part of the plan's ID and can't be changed — create a new plan instead.");
  }
  const data: Prisma.DeliveryPlanUpdateInput = {};
  if (patch.supplierName !== undefined) {
    if (!patch.supplierName.trim()) throw new ValidationError("A delivery plan needs a supplier.");
    data.supplierName = patch.supplierName.trim();
  }
  if (patch.expectedArrivalDate !== undefined) {
    if (yearOf(patch.expectedArrivalDate) === undefined) throw new ValidationError("The expected arrival date must be YYYY-MM-DD.");
    data.expectedArrivalDate = patch.expectedArrivalDate.trim();
  }
  if (patch.plannedDeliveryDate !== undefined) data.plannedDeliveryDate = text(patch.plannedDeliveryDate);
  if (patch.supplierCode !== undefined) data.supplierCode = text(patch.supplierCode);
  if (patch.expectedQuantityKg !== undefined) data.expectedQuantityKg = quantity(patch.expectedQuantityKg);
  if (patch.expectedTruckType !== undefined) data.expectedTruckType = text(patch.expectedTruckType);
  if (patch.remarks !== undefined) data.remarks = text(patch.remarks);
  const row = await prisma.deliveryPlan.update({ where: { id }, data, include: INCLUDE });
  return toWire(row, today());
}
