/**
 * Doc §3's dashboard line items, server-side: for any period, total trucks received, accepted &
 * unloaded, GRN completed, pending QA, pending unload after QA, and rejected.
 */
import type { FastifyInstance } from "fastify";
import { dashboardCounts } from "../services/dashboard.js";

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/api/dashboard", async (req) => {
    const { from, to } = req.query as { from?: string; to?: string };
    return dashboardCounts({ from, to });
  });
}
