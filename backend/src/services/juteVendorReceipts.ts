/**
 * Jute bags received from a vendor. The bags, the date and the warehouse live on the warehouse stock row this creates, so
 * the running balance and the reconciliation read them with nothing added; this table holds only what that ledger has no
 * column for. The two rows are written together, or not at all.
 */
import {
  JUTE_PURCHASE_ACTIVITY, parseBags, shortQuantity, vendorReceiptProblems, type VendorReceiptInput,
} from "@anagroci/contract/domain/juteVendorReceipt";
import { prisma } from "../db.js";
import { ValidationError } from "../domain/validation.js";
import { categoriseActivity } from "./imports.js";
import { nextMovementNumbers } from "./ledgers.js";

const INCLUDE = {
  movement: { select: { sn: true, movementDate: true, whLocation: true, bagsReceived: true } },
  createdBy: { select: { displayName: true } },
} as const;

type Row = NonNullable<Awaited<ReturnType<typeof findOne>>>;
const findOne = (id: string) => prisma.juteVendorReceipt.findUnique({ where: { id }, include: INCLUDE });

function toView(r: Row) {
  const received = r.movement.bagsReceived ?? 0;
  return {
    id: r.id,
    sn: r.movement.sn,
    date: r.movement.movementDate?.toISOString().slice(0, 10) ?? null,
    warehouse: r.movement.whLocation,
    vendorName: r.vendorName,
    deliveryNoteNo: r.deliveryNoteNo,
    invoicedQty: r.invoicedQty,
    receivedQty: received,
    shortQty: shortQuantity(r.invoicedQty, received),
    remarks: r.remarks,
    createdBy: r.createdBy?.displayName ?? null,
  };
}

export async function listVendorReceipts(site?: string[]) {
  const rows = await prisma.juteVendorReceipt.findMany({
    where: site ? { movement: { whLocation: { in: site } } } : undefined,
    include: INCLUDE,
    orderBy: { movement: { seq: "desc" } },
  });
  return rows.map(toView);
}

export async function createVendorReceipt(input: VendorReceiptInput, warehouse: string, actorId: string) {
  const problems = vendorReceiptProblems(input);
  if (problems.length) throw new ValidationError(problems.join(" "));

  const id = await prisma.$transaction(async (tx) => {
    if (!(await tx.warehouse.findUnique({ where: { name: warehouse }, select: { name: true } }))) {
      throw new ValidationError(`Warehouse "${warehouse}" isn't in the warehouse master.`);
    }
    const movement = await tx.juteWarehouseMovement.create({
      data: {
        ...(await nextMovementNumbers(tx)),
        movementDate: new Date(`${input.date!.trim()}T00:00:00Z`),
        activitiesType: JUTE_PURCHASE_ACTIVITY,
        activityCategory: categoriseActivity(JUTE_PURCHASE_ACTIVITY),
        whLocation: warehouse,
        bagsReceived: parseBags(input.receivedQty)!,
      },
    });
    const receipt = await tx.juteVendorReceipt.create({
      data: {
        movementId: movement.id,
        vendorName: input.vendorName!.trim(),
        deliveryNoteNo: input.deliveryNoteNo!.trim(),
        invoicedQty: parseBags(input.invoicedQty)!,
        remarks: input.remarks?.trim() || null,
        createdById: actorId,
      },
    });
    return receipt.id;
  });
  return toView((await findOne(id))!);
}
