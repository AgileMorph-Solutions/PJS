/**
 * A warehouse's opening jute bag count. The bags and the date are the first row of its stock ledger, so the running balance
 * and the reconciliation read them with no second calculation. This table holds only what that row has no column for.
 */
import type { User } from "@prisma/client";
import { JUTE_OPENING_ACTIVITY, openingBalanceProblems, type OpeningBalanceInput } from "@anagroci/contract/domain/juteOpeningBalance";
import { parseBags } from "@anagroci/contract/domain/juteVendorReceipt";
import { prisma } from "../db.js";
import { ForbiddenError, ValidationError } from "../domain/validation.js";
import { categoriseActivity } from "./imports.js";

const INCLUDE = {
  movement: { select: { movementDate: true, whLocation: true, bagsReceived: true } },
  createdBy: { select: { displayName: true } },
  updatedBy: { select: { displayName: true } },
} as const;

type Row = NonNullable<Awaited<ReturnType<typeof findOne>>>;
const findOne = (id: string) => prisma.juteOpeningBalance.findUnique({ where: { id }, include: INCLUDE });

const toView = (r: Row) => ({
  id: r.id,
  warehouse: r.movement.whLocation,
  date: r.movement.movementDate?.toISOString().slice(0, 10) ?? null,
  bags: r.movement.bagsReceived ?? 0,
  remarks: r.remarks,
  createdBy: r.createdBy?.displayName ?? null,
  updatedBy: r.updatedBy?.displayName ?? null,
});

export async function listOpeningBalances(site?: string[]) {
  const rows = await prisma.juteOpeningBalance.findMany({
    where: site ? { movement: { whLocation: { in: site } } } : undefined,
    include: INCLUDE,
    orderBy: { movement: { whLocation: "asc" } },
  });
  return rows.map(toView);
}

/**
 * Sets the warehouse's opening balance. Changing one rewrites every running balance after it, so once it is set only an
 * admin can change it, and the change records who did it.
 */
export async function setOpeningBalance(input: OpeningBalanceInput, warehouse: string, actor: Pick<User, "id" | "role">) {
  const problems = openingBalanceProblems(input);
  if (problems.length) throw new ValidationError(problems.join(" "));
  const movementFields = {
    movementDate: new Date(`${input.date!.trim()}T00:00:00Z`),
    bagsReceived: parseBags(input.bags)!,
  };
  const remarks = input.remarks?.trim() || null;

  const id = await prisma.$transaction(async (tx) => {
    if (!(await tx.warehouse.findUnique({ where: { name: warehouse }, select: { name: true } }))) {
      throw new ValidationError(`Warehouse "${warehouse}" isn't in the warehouse master.`);
    }
    const existing = await tx.juteOpeningBalance.findFirst({ where: { movement: { whLocation: warehouse } }, select: { id: true, movementId: true } });
    if (existing) {
      if (actor.role !== "admin") throw new ForbiddenError(`The opening stock for ${warehouse} is already set. Only an Admin can change it.`);
      await tx.juteWarehouseMovement.update({ where: { id: existing.movementId }, data: movementFields });
      await tx.juteOpeningBalance.update({ where: { id: existing.id }, data: { remarks, updatedById: actor.id } });
      return existing.id;
    }
    // Below every other row, so it sorts first in this warehouse however late it is entered. seq is unique across warehouses.
    const lowest = (await tx.juteWarehouseMovement.aggregate({ _min: { seq: true } }))._min.seq ?? 1;
    const movement = await tx.juteWarehouseMovement.create({
      data: {
        ...movementFields,
        seq: Math.min(lowest, 1) - 1,
        activitiesType: JUTE_OPENING_ACTIVITY,
        activityCategory: categoriseActivity(JUTE_OPENING_ACTIVITY),
        whLocation: warehouse,
      },
    });
    return (await tx.juteOpeningBalance.create({ data: { movementId: movement.id, remarks, createdById: actor.id } })).id;
  });
  return toView((await findOne(id))!);
}
