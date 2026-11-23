/**
 * Doc §3's dashboard line items, for any period: total trucks received, accepted & unloaded, GRN
 * completed, pending QA, pending unload after QA, rejected. Delegates the actual counting to
 * computeDashboardCounts() in @anagroci/contract — this only loads and shapes the inputs it needs.
 */
import { computeDashboardCounts, GRN_QUANTITY_LABEL } from "@anagroci/contract/domain/receiptStatus";
import { STAGE_FIELD_MAP } from "@anagroci/contract/generated/stageFieldMap";
import { prisma } from "../db.js";
import { assembleStageData, assembleBranches } from "../stageStore.js";

// deriveStatus tells "GRN completed" from "unloaded" by the GRN quantity (for a truck entered in the app) and by where the
// truck came from, so a count that leaves those out silently reports far fewer GRNs than there are. Everything else it reads
// is whether a stage or a decision exists.
const GRN = STAGE_FIELD_MAP["n-grn"]!;
const GRN_QUANTITY_COLUMN = GRN.fields.find((f) => f.label === GRN_QUANTITY_LABEL)!.col;

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
    select: {
      source: true,
      stageEntries: { select: { stageId: true } },
      branches: { select: { stageId: true, branchId: true } },
      [GRN.relation]: { select: { [GRN_QUANTITY_COLUMN]: true } },
    },
  });

  const counts = computeDashboardCounts(
    rows.map((r) => ({ source: (r as unknown as { source: string }).source as "imported" | "entered", stageData: assembleStageData(r), branches: assembleBranches(r) }))
  );
  return { ...counts, period: { from: from ?? null, to: to ?? null } };
}
