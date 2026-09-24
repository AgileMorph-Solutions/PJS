/**
 * Reads for the two production stock views (production_bin_stock, production_silo_stock) added by
 * migration 20260924125232_production_stock_views — the production twin of juteBalance.ts. Unlike
 * juteBalance.ts's $queryRawUnsafe (which interpolates a dynamic view name), both view names here
 * are fixed literals, so a typed, parameterized $queryRaw is enough — no unsafe string building.
 */
import { prisma } from "../db.js";

export interface BinStockRow {
  binNo: string;
  date: string;
  qty_in: string;
  qty_out: string;
  movement_type: string;
  source_id: string;
  running_balance: string;
}

export interface SiloStockRow {
  id: string;
  binNo: string;
  date: string | null;
  sizedRcnKgs: string | null;
  cookedQtyKgs: string | null;
  reported_opening: string | null;
  reported_closing: string | null;
  computed_balance: string;
}

/** The running RCN balance for one Bin — received (BtmReceipt) minus issued-to-silos
 * (CalibrationRun), oldest first. See migration's own header comment for the date-ordering caveat
 * (dates are strings; >99% are ISO-prefixed so text order matches chronological order). */
export async function binStock(binNo: string): Promise<BinStockRow[]> {
  return prisma.$queryRaw<BinStockRow[]>`
    SELECT * FROM "production_bin_stock" WHERE "binNo" = ${binNo} ORDER BY "date", "source_id"
  `;
}

/** The silo running balance for one Bin, alongside the sheet's own (unreliable — now:false)
 * reported opening/closing for comparison. Never overwrites reported_opening/reported_closing. */
export async function siloStock(binNo: string): Promise<SiloStockRow[]> {
  return prisma.$queryRaw<SiloStockRow[]>`
    SELECT * FROM "production_silo_stock" WHERE "binNo" = ${binNo} ORDER BY "date", "id"
  `;
}
