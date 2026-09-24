/**
 * Lot service — the production twin of services/receipts.ts, scoped to the Lot spine (everything
 * from Cooking through Packing — 13 tables). A Lot is created at Cooking, never before (confirmed
 * rule — see productionStages.ts's n-cook note): createCookingRun is the ONLY function here that
 * creates a ProductionLot row. Every other function requires the Lot to already exist.
 */
import { deriveLotStatus } from "@anagroci/contract/domain/productionStatus";
import { PRODUCTION_FIELD_MAP } from "@anagroci/contract/generated/productionFieldMap";
import { prisma } from "../../db.js";
import { presentTables, createProductionRow, listProductionRows } from "../../productionStore.js";
import { assertOneBinPerLot, ValidationError } from "../../domain/validation.js";

export interface WriteOpts { bypassValidation?: boolean }

export async function listLots() {
  return prisma.productionLot.findMany({ orderBy: { lotNo: "asc" } });
}

export async function getLot(lotNo: string) {
  const row = await prisma.productionLot.findUnique({ where: { lotNo } });
  if (!row) return null;
  const tables = await presentTables("lot", lotNo);
  // Same caveat as getBtmIntake: no branch storage yet for n-qc8's Packing/Peeling routing, and
  // "dispatched" needs a content check (anyDispatched) this pass doesn't compute — both left at
  // their safe defaults rather than faked, so status only ever reports what's actually known.
  const status = deriveLotStatus({ branches: {}, tables });
  return { ...row, tables, status };
}

/** The only place a ProductionLot row is created — see file header. */
export async function createCookingRun(lotNo: string, binNo: string, fields: Record<string, string>, opts: WriteOpts = {}) {
  if (!lotNo || !lotNo.trim()) throw new ValidationError("A Lot No is required.");
  if (!binNo || !binNo.trim()) throw new ValidationError("A Bin No is required — a Lot is created at Cooking and always belongs to a Bin.");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.productionLot.findUnique({ where: { lotNo } });
    if (existing) {
      if (!opts.bypassValidation) assertOneBinPerLot(existing.binNo, binNo);
    } else {
      await tx.productionBin.upsert({ where: { binNo }, update: {}, create: { binNo, source: "auto-observed" } });
      await tx.productionLot.create({ data: { lotNo, binNo, source: "auto-observed" } });
    }
    return createProductionRow("cooking-run", lotNo, fields, tx);
  });
}

/**
 * Every Lot-spine write except Cooking: the Lot must already exist. "A lot cannot be shelled
 * before it's been cooked" is the natural ordering the confirmed flow already implies (Cooking is
 * Phase 3; everything else here is Phase 4 onward) — enforced here rather than per-route so no
 * future route can forget it.
 */
async function addLotRow(tableId: string, lotNo: string, fields: Record<string, string>) {
  const spec = PRODUCTION_FIELD_MAP[tableId];
  if (!spec || spec.spine !== "lot") throw new ValidationError(`"${tableId}" is not a Lot-spine production table.`);
  const lot = await prisma.productionLot.findUnique({ where: { lotNo } });
  if (!lot) {
    throw new ValidationError(
      `Lot "${lotNo}" has not been cooked yet — a Lot is created at Cooking, and every later step ` +
      "(shelling, Borma, packing, …) requires the Lot to already exist."
    );
  }
  return createProductionRow(tableId, lotNo, fields);
}

export const addShellingRunRow = (lotNo: string, fields: Record<string, string>) => addLotRow("shelling-run", lotNo, fields);
export const addBormaRunRow = (lotNo: string, fields: Record<string, string>) => addLotRow("borma-run", lotNo, fields);
export const addPackingRecordRow = (lotNo: string, fields: Record<string, string>) => addLotRow("packing-record", lotNo, fields);

/** Catch-all for the remaining Lot-spine tables (shelling-machine-sample, shell-waste-sample, etc.)
 * — validated the same way as the named functions above, just generic over tableId. */
export const addLotTableRow = addLotRow;

export async function listLotChildRows(tableId: string, lotNo: string) {
  return listProductionRows(tableId, lotNo);
}
