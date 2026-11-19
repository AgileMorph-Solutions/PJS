/**
 * What is waiting for the caller's decision in production (services/production/approvals.ts), for the Approvals page and
 * its sidebar badge. Thin: the decisions themselves are the routes that already make them (rcnReceipts.ts, calibration.ts,
 * factoryLots.ts). A role that decides nothing (QFS Officer, Factory Manager) gets an empty list.
 */
import type { FastifyInstance } from "fastify";
import { currentUser } from "../auth/plugin.js";
import { listProductionApprovals } from "../services/production/approvals.js";
import { siteFor } from "./productionBatches.js";

export async function productionApprovalRoutes(app: FastifyInstance) {
  app.get("/api/production/approvals", async (req) => listProductionApprovals(await siteFor(req), currentUser(req).role));
}
