/**
 * Doc §3's dashboard line items, for any period: total trucks received, accepted & unloaded, GRN
 * completed, pending QA, pending unload after QA, rejected. Delegates the actual counting to
 * computeDashboardCounts() in @anagroci/contract — this only loads and shapes the inputs it needs.
 */
import { computeDashboardCounts } from "@anagroci/contract/domain/receiptStatus";
import { prisma } from "../db.js";
import { assembleStageData, assembleBranches } from "../stageStore.js";

export interface DashboardPeriod { from?: string; to?: string; site?: string[] }

export async function dashboardCounts({ from, to, site }: DashboardPeriod) {
  // arrivalDate is a YYYY-MM-DD string, so lexicographic comparison is chronological.
  const where = {
    ...(from || to ? { arrivalDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(site ? { warehouse: { in: site } } : {}),
  };

  const rows = await prisma.receipt.findMany({
    where,
    // Only what deriveStatus reads — no need to hydrate every stage payload for a count.
    select: { stageEntries: { select: { stageId: true } }, branches: { select: { stageId: true, branchId: true } } },
  });

  const counts = computeDashboardCounts(
    rows.map((r) => ({ stageData: assembleStageData(r), branches: assembleBranches(r) }))
  );
  return { ...counts, period: { from: from ?? null, to: to ?? null } };
}
