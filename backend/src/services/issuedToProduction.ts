/**
 * Issued to Production Section — read-only. No site column on this table at all (confirmed:
 * IssuedToProduction has no warehouseSite/warehouse field — the sheet itself carries none), so
 * unlike every other site-scoped list here, this one is never filtered by resolveSite(); it is
 * logically central/Yakro-Factory-side data (see receiptsDownstream.ts's `issued` flag, reached
 * only via the Bouaké→Yamoussoukro transfer chain), but there is no real column to scope it by.
 */
import { prisma } from "../db.js";

export async function listIssuedToProduction() {
  return prisma.issuedToProduction.findMany({
    orderBy: [{ date: "asc" }, { sNo: "asc" }],
  });
}
