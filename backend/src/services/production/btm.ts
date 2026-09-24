/**
 * BTM (Bordereau de Transfer) intake service — the production twin of services/receipts.ts, scoped
 * to the BTM spine (btm-receipt, btm-input-quality, calibration-run, btm-tally-row). All Prisma
 * calls for this spine live here; routes and (eventually) the seeder both go through it.
 */
import { deriveBtmStatus } from "@anagroci/contract/domain/productionStatus";
import { prisma } from "../../db.js";
import { presentTables, createProductionRow, listProductionRows } from "../../productionStore.js";
import { assertOneBinPerBtm, ValidationError } from "../../domain/validation.js";

export interface WriteOpts { bypassValidation?: boolean }

export async function listBtmIntakes() {
  return prisma.btmIntake.findMany({ orderBy: { btmNo: "asc" } });
}

export async function getBtmIntake(btmNo: string) {
  const row = await prisma.btmIntake.findUnique({ where: { btmNo } });
  if (!row) return null;
  const tables = await presentTables("btm", btmNo);
  // No decision/branch storage exists yet for BTM (nothing in this pass records n-qc1's
  // pass/fail) — branches is empty rather than faked, so deriveBtmStatus falls through to the
  // table-presence ladder exactly as it does for any BTM with no recorded quality-hold.
  const status = deriveBtmStatus({ branches: {}, tables });
  return { ...row, tables, status };
}

/**
 * Registers a BTM's destination Bin on first observation (auto-observing the Bin master the same
 * way masters.ts's addBin does), or enforces assertOneBinPerBtm against what's already recorded.
 * Shared by every BTM-spine write below — this is the one place the "BTM -> exactly one Bin" rule
 * is enforced, so every entry point gets it for free rather than each route remembering to call it.
 */
async function registerBtmIntake(tx: typeof prisma, btmNo: string, binNo: string, opts: WriteOpts) {
  if (!btmNo || !btmNo.trim()) throw new ValidationError("A BTM No is required.");
  if (!binNo || !binNo.trim()) throw new ValidationError("A destination Bin No is required.");
  const existing = await tx.btmIntake.findUnique({ where: { btmNo } });
  if (existing) {
    if (!opts.bypassValidation) assertOneBinPerBtm(existing.binNo, binNo);
    return existing;
  }
  await tx.productionBin.upsert({ where: { binNo }, update: {}, create: { binNo, source: "auto-observed" } });
  return tx.btmIntake.create({ data: { btmNo, binNo, source: "auto-observed" } });
}

export async function addBtmRow(tableId: string, btmNo: string, binNo: string, fields: Record<string, string>, opts: WriteOpts) {
  return prisma.$transaction(async (tx) => {
    await registerBtmIntake(tx as unknown as typeof prisma, btmNo, binNo, opts);
    return createProductionRow(tableId, btmNo, fields, tx);
  });
}

export const addBtmReceiptLine = (btmNo: string, binNo: string, fields: Record<string, string>, opts: WriteOpts = {}) =>
  addBtmRow("btm-receipt", btmNo, binNo, fields, opts);

export const addBtmInputQualityRow = (btmNo: string, binNo: string, fields: Record<string, string>, opts: WriteOpts = {}) =>
  addBtmRow("btm-input-quality", btmNo, binNo, fields, opts);

export const addCalibrationRunRow = (btmNo: string, binNo: string, fields: Record<string, string>, opts: WriteOpts = {}) =>
  addBtmRow("calibration-run", btmNo, binNo, fields, opts);

export const addBtmTallyRow = (btmNo: string, binNo: string, fields: Record<string, string>, opts: WriteOpts = {}) =>
  addBtmRow("btm-tally-row", btmNo, binNo, fields, opts);

export async function listBtmChildRows(tableId: string, btmNo: string) {
  return listProductionRows(tableId, btmNo);
}
