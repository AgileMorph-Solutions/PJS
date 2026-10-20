/**
 * Doc §3's dashboard line items, server-side: for any period, total trucks received, accepted &
 * unloaded, GRN completed, pending QA, pending unload after QA, and rejected.
 */
import type { FastifyInstance } from "fastify";
import { dashboardCounts } from "../services/dashboard.js";
import { supplierAnalytics } from "../services/supplierAnalytics.js";
import { scopedSite } from "../auth/scope.js";

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/api/dashboard", async (req) => {
    const { from, to, warehouse } = req.query as { from?: string; to?: string; warehouse?: string };
    return dashboardCounts({ from, to, site: await scopedSite(req, warehouse) });
  });

  // Per-supplier figures for the same period and site. Not in policy.ts's narrow-role allow-list, so a QFS officer or
  // Branch Manager is refused: this is Warehouse Incharge / admin reading, as the supplier page is.
  app.get("/api/dashboard/suppliers", async (req) => {
    const { from, to, warehouse } = req.query as { from?: string; to?: string; warehouse?: string };
    return supplierAnalytics({ from, to, site: await scopedSite(req, warehouse) });
  });
}
