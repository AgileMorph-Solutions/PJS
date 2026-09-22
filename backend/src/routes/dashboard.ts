/**
 * Doc §3's dashboard line items, server-side: for any period, total trucks received, accepted &
 * unloaded, GRN completed, pending QA, pending unload after QA, and rejected.
 *
 * "For any period" is the part that was missing — the previous version took no date range at all.
 */
import type { FastifyInstance } from "fastify";
import { computeDashboardCounts } from "@anagroci/contract/domain/receiptStatus";
import { prisma } from "../db.js";
import { assembleStageData, assembleBranches } from "../stageStore.js";

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/api/dashboard", async (req) => {
    const { from, to } = req.query as { from?: string; to?: string };

    // arrivalDate is a YYYY-MM-DD string, so lexicographic comparison is chronological.
    const where =
      from || to
        ? { arrivalDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {};

    const rows = await prisma.receipt.findMany({
      where,
      // Only what deriveStatus reads — no need to hydrate every stage payload for a count.
      select: { stageEntries: { select: { stageId: true } }, branches: { select: { stageId: true, branchId: true } } },
    });

    const counts = computeDashboardCounts(
      rows.map((r) => ({ stageData: assembleStageData(r), branches: assembleBranches(r) }))
    );
    return { ...counts, period: { from: from ?? null, to: to ?? null } };
  });
}
