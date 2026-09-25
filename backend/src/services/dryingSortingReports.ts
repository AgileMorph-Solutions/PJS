/**
 * Drying & Sorting Report (Bouaké detail) — read-only. Every real row today is BOUAKE-side (the
 * source file is unit-only), but scoped by site the same way every other new table is, rather than
 * assuming that never changes.
 */
import { prisma } from "../db.js";

export async function listDryingSortingReports(site?: string[]) {
  return prisma.dryingSortingReport.findMany({
    where: site ? { warehouseSite: { in: site } } : {},
    orderBy: [{ dryingDate: "asc" }, { sn: "asc" }],
  });
}
