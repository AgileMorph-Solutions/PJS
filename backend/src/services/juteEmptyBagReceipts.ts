/**
 * Empty jute bags received from another warehouse. The bags, date, truck and receipt number live on the receiving warehouse's
 * stock row this creates, so the running balance and the reconciliation read them with nothing added; this table holds only
 * what that ledger has no column for. The two rows are written together, or not at all.
 *
 * The sending warehouse's stock is not touched here: it records what it sends as bags issued on its own ledger, as Bouaké's
 * real rows do, and reducing it again would count those bags twice.
 */
import { JUTE_TRANSFER_IN_ACTIVITY, emptyBagReceiptProblems, type EmptyBagReceiptInput } from "@anagroci/contract/domain/juteEmptyBagReceipt";
import { parseBags } from "@anagroci/contract/domain/juteVendorReceipt";
import { isUsableSite } from "@anagroci/contract/domain/siteType";
import { prisma } from "../db.js";
import { ValidationError } from "../domain/validation.js";
import { categoriseActivity } from "./imports.js";
import { nextMovementNumbers } from "./ledgers.js";

const INCLUDE = {
  movement: { select: { sn: true, movementDate: true, whLocation: true, truckNumber: true, wrNo: true, bagsReceived: true } },
  createdBy: { select: { displayName: true } },
} as const;

type Row = NonNullable<Awaited<ReturnType<typeof findOne>>>;
const findOne = (id: string) => prisma.juteEmptyBagReceipt.findUnique({ where: { id }, include: INCLUDE });

const toView = (r: Row) => ({
  id: r.id,
  sn: r.movement.sn,
  date: r.movement.movementDate?.toISOString().slice(0, 10) ?? null,
  fromWarehouse: r.fromWarehouse,
  warehouse: r.movement.whLocation,
  truckNumber: r.movement.truckNumber,
  warehouseReceiptNo: r.movement.wrNo,
  bagsReceived: r.movement.bagsReceived ?? 0,
  responsibleParty: r.responsibleParty,
  createdBy: r.createdBy?.displayName ?? null,
});

export async function listEmptyBagReceipts(site?: string[]) {
  const rows = await prisma.juteEmptyBagReceipt.findMany({
    where: site ? { movement: { whLocation: { in: site } } } : undefined,
    include: INCLUDE,
    orderBy: { movement: { seq: "desc" } },
  });
  return rows.map(toView);
}

/**
 * The warehouses empty bags can be received from: every ready warehouse (BOUAKE, YAKRO FACTORY — a category and an ID
 * code, contract's isUsableSite), by name. This is the one place a Warehouse Incharge needs ANOTHER warehouse's name —
 * their /api/masters holds only their own (services/masters.ts) — so it has its own read, as a BKT's destinations do.
 * Names only; nothing else of another warehouse is exposed.
 */
export async function listEmptyBagSources(): Promise<string[]> {
  const rows = await prisma.warehouse.findMany({ where: { site: null }, select: { name: true, site: true, type: true, code: true } });
  return rows.filter(isUsableSite).map((r) => r.name).sort((a, b) => a.localeCompare(b));
}

export async function createEmptyBagReceipt(input: EmptyBagReceiptInput, warehouse: string, actorId: string) {
  const problems = emptyBagReceiptProblems(input, warehouse);
  if (problems.length) throw new ValidationError(problems.join(" "));
  const fromWarehouse = input.fromWarehouse!.trim();

  const id = await prisma.$transaction(async (tx) => {
    for (const name of [warehouse, fromWarehouse]) {
      if (!(await tx.warehouse.findUnique({ where: { name }, select: { name: true } }))) {
        throw new ValidationError(`Warehouse "${name}" isn't in the warehouse master.`);
      }
    }
    const movement = await tx.juteWarehouseMovement.create({
      data: {
        ...(await nextMovementNumbers(tx)),
        movementDate: new Date(`${input.date!.trim()}T00:00:00Z`),
        activitiesType: JUTE_TRANSFER_IN_ACTIVITY,
        activityCategory: categoriseActivity(JUTE_TRANSFER_IN_ACTIVITY),
        whLocation: warehouse,
        truckNumber: input.truckNumber?.trim() || null,
        wrNo: input.warehouseReceiptNo?.trim() || null,
        bagsReceived: parseBags(input.bagsReceived)!,
      },
    });
    const receipt = await tx.juteEmptyBagReceipt.create({
      data: {
        movementId: movement.id,
        fromWarehouse,
        responsibleParty: input.responsibleParty!.trim(),
        createdById: actorId,
      },
    });
    return receipt.id;
  });
  return toView((await findOne(id))!);
}
