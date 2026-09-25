/**
 * Reads the SQL views created in the lot_unique_and_jute_views migration.
 *
 * These are raw queries on purpose. Prisma's `views` preview feature adds migrate friction for no
 * benefit here, and the whole point of these views is that the running balance and the
 * reconciliation totals have no column anyone could write to — so they are read-only by nature.
 */
import { prisma } from "../db.js";

export interface BalanceRow {
  id: string; seq: number; sn: number | null; whLocation: string;
  bagsIssued: number | null; bagsReceived: number | null;
  reportedBalance: number | null;
  computed_balance: string | number | null;
  balance_delta: string | number | null;
}

/** Ledger 1 with the running balance computed by window function, never stored. `site`, when
 * given, is a resolved list of names (domain/site.ts's resolveSite) — filtered in JS rather than
 * SQL since this reads through $queryRawUnsafe with no parameter binding. */
export async function warehouseBalanceRows(site?: string[]): Promise<BalanceRow[]> {
  const rows = await prisma.$queryRawUnsafe<BalanceRow[]>(
    `SELECT * FROM "jute_warehouse_movement_balance" ORDER BY "whLocation", "seq"`
  );
  return site ? rows.filter((r) => site.includes(r.whLocation)) : rows;
}

/**
 * Rows where the workbook's own BALANCE disagrees with its own arithmetic.
 * Zero on the imported data — which is the import-fidelity proof, and a standing regression guard.
 */
export async function balanceDriftRows(): Promise<BalanceRow[]> {
  return prisma.$queryRawUnsafe<BalanceRow[]>(
    `SELECT * FROM "jute_warehouse_movement_balance"
      WHERE "reportedBalance" IS NOT NULL AND balance_delta <> 0
      ORDER BY "seq"`
  );
}

/** Rows whose reported balance is genuinely negative — real, and reported rather than corrected. */
export async function negativeBalanceRows(): Promise<BalanceRow[]> {
  return prisma.$queryRawUnsafe<BalanceRow[]>(
    `SELECT * FROM "jute_warehouse_movement_balance" WHERE "reportedBalance" < 0 ORDER BY "seq"`
  );
}

export interface ReconciliationRow {
  warehouse_name: string; period: string;
  opening: bigint | null; receipts: bigint | null; transfers_in: bigint | null;
  issues: bigint | null; damaged_or_discarded: bigint | null; transfers_out: bigint | null;
  expected_closing: bigint | null;
}

/**
 * opening + receipts + transfers in − issues − damaged/discarded − transfers out, per warehouse
 * and period, across all four ledgers. Not expressible over ledger 1 alone: ledger 1 has no
 * damaged/discarded column at all.
 */
export async function reconciliation(site?: string[]): Promise<ReconciliationRow[]> {
  const rows = await prisma.$queryRawUnsafe<ReconciliationRow[]>(
    `SELECT * FROM "jute_reconciliation" ORDER BY warehouse_name, period`
  );
  return site ? rows.filter((r) => site.includes(r.warehouse_name)) : rows;
}

export interface TransferFlagRow {
  id: string; sn: number; bagsReceived: number | null; reportedDiff: number | null;
  reportedDifference: number | null; diff_is_degenerate: boolean; difference_mismatch: boolean;
}

export async function transferFlagRows(): Promise<TransferFlagRow[]> {
  return prisma.$queryRawUnsafe<TransferFlagRow[]>(
    `SELECT * FROM "jute_transfer_receipt_flags" ORDER BY "sn"`
  );
}

/** JSON.stringify can't serialise BigInt, and the aggregate views return them. */
export function jsonSafe<T>(rows: T[]): T[] {
  return rows.map((r) =>
    Object.fromEntries(
      Object.entries(r as Record<string, unknown>).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])
    )
  ) as T[];
}
