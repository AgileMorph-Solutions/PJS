/**
 * Drying Batch (consolidated, both sites) — read-only, the Drying page's primary source. Replaces
 * DryingJob (whose only source, "FINAL DRY RCN-YAKRO-2026", is retired — see truckReception.ts's
 * sibling importers for the same reasoning). DryingJob's own rows are kept, unread, as a
 * provenance trail rather than deleted — see drying_batch_vs_drying_job_drift's own comment for
 * why the two were never merged: 33 of 81 central rows disagree on date/status/destination.
 */
import { prisma } from "../db.js";

export async function listDryingBatches(site?: string[]) {
  return prisma.dryingBatch.findMany({
    where: site ? { warehouseSite: { in: site } } : {},
    orderBy: [{ dryingDate: "asc" }, { sn: "asc" }],
  });
}
