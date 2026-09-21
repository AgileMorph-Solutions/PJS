// Implements doc §3's dashboard line items server-side — same computeDashboardCounts logic the
// frontend runs client-side today, now running over the real table instead of localStorage.
import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { computeDashboardCounts } from "../domain/receiptStatus.js";

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/api/dashboard", async () => {
    const rows = await prisma.receipt.findMany({ select: { branches: true, stageData: true } });
    const parsed = rows.map((r) => ({
      branches: JSON.parse(r.branches) as Record<string, string>,
      stageData: JSON.parse(r.stageData) as Record<string, Record<string, string>>,
    }));
    return computeDashboardCounts(parsed);
  });
}
