/**
 * Warehouse activity Ledger — read-only. No site column exists in this sheet at all (verified when
 * building the importer, not assumed), so unlike every other new table this one can't be scoped by
 * ?warehouse= — it's the same flat list for both sections.
 */
import { prisma } from "../db.js";

export async function listWarehouseActivityLedger() {
  return prisma.warehouseActivityLedgerEntry.findMany({ orderBy: { sheetRow: "asc" } });
}
