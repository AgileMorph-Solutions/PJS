/**
 * Unit-warehouse dispatch (CHARGEMENT) — read-only, for the new "Dispatch to Central" page. The
 * importer (domain/imports/warehouseDispatches.ts) stores one row per LINE, so this groups by
 * vyogeNumber for a document-level view; a null vyogeNumber (40/544 real lines) stays its own
 * single-line group rather than being merged into an "unknown" bucket that would hide the gap.
 */
import { prisma } from "../db.js";

export async function listWarehouseDispatchLines(site?: string[]) {
  return prisma.warehouseDispatchLine.findMany({
    where: site ? { warehouseSite: { in: site } } : {},
    orderBy: [{ chargeDate: "asc" }, { sn: "asc" }],
  });
}
