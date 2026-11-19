/**
 * The Logs page: every field change on a warehouse's trucks. Warehouse Incharge sees their own warehouse (scopedSite pins
 * it), an admin any or all. Branch Managers and QFS Officers are refused by auth/policy.ts's default-deny; price and
 * amount rows are dropped for roles that may not see them by auth/redact.ts, like every other response.
 */
import type { FastifyInstance } from "fastify";
import { listSiteFieldChanges } from "../services/fieldHistory.js";
import { scopedSite } from "../auth/scope.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function logRoutes(app: FastifyInstance) {
  app.get("/api/field-changes", async (req, reply) => {
    const { warehouse, from, to } = req.query as { warehouse?: string; from?: string; to?: string };
    for (const d of [from, to]) if (d && !ISO_DATE.test(d)) return reply.code(400).send({ error: "Dates must be YYYY-MM-DD." });
    return listSiteFieldChanges(await scopedSite(req, warehouse), from, to);
  });
}
