/**
 * WarehouseDischarge — read-only. Shared by TWO importers (warehouseDischarges/DISCHARGEMENT,
 * unit-only, and warehouseReceiving, both sites — see each importer's own header comment), keyed
 * on `(warehouseSite, lotNo)`, so this single list naturally covers both: Bouaké's own discharge
 * rows and Yamoussoukro's receiving rows appear side by side, distinguishable by `warehouseSite`.
 */
import { prisma } from "../db.js";

export async function listWarehouseDischarges(site?: string[]) {
  return prisma.warehouseDischarge.findMany({
    where: site ? { warehouseSite: { in: site } } : {},
    orderBy: [{ warehouseSite: "asc" }, { sn: "asc" }],
  });
}
