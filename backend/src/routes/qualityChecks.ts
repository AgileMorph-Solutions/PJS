/**
 * The QFS Officer's quality checks (26 Nov 2026): their list across every section, and the warehouse checks they send for the
 * Warehouse Incharge's approval (contract domain/qualityChecks.ts). Thin: the work is in services/qualityChecks.ts and
 * services/qualitySubmissions.ts.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { currentSite, currentUser, requireRole } from "../auth/plugin.js";
import { QUALITY_CHECK_TAKERS } from "@anagroci/contract/data/roles";
import { assertWarehouseAccess, scopedSite } from "../auth/scope.js";
import { ValidationError } from "../domain/validation.js";
import { prisma } from "../db.js";
import { siteOf } from "../services/ids.js";
import { qualityChecks } from "../services/qualityChecks.js";
import {
  approveQualityCheck, listQualitySubmissions, qualitySubmissionWarehouse, qualityTarget, rejectQualityCheck, submitQualityCheck,
} from "../services/qualitySubmissions.js";

/** The site the list is for: the caller's own; an Admin names one. */
async function listSite(req: FastifyRequest): Promise<string> {
  const { warehouse } = req.query as { warehouse?: string };
  if (warehouse) await assertWarehouseAccess(req, warehouse);
  const name = warehouse ?? currentSite(req);
  if (!name) throw new ValidationError("Choose the warehouse.");
  return (await siteOf(prisma, name)) ?? name;
}

export async function qualityCheckRoutes(app: FastifyInstance) {
  const takers = { preHandler: requireRole(...QUALITY_CHECK_TAKERS) };
  const reviewers = { preHandler: requireRole("admin", "warehouse_incharge") };

  app.get("/api/quality-checks", async (req) => qualityChecks(await listSite(req), currentUser(req).id));

  /** A QFS Officer sends a drying or transfer lot check, at their own warehouse. */
  app.post("/api/quality-submissions", takers, async (req, reply) => {
    const { kind, targetId, values } = (req.body ?? {}) as { kind?: unknown; targetId?: unknown; values?: unknown };
    await assertWarehouseAccess(req, (await qualityTarget(kind, targetId)).warehouse);
    return reply.code(201).send(await submitQualityCheck(currentUser(req), kind, targetId, values));
  });

  /** Reviewers see their warehouse's; a QFS Officer only their own. */
  app.get("/api/quality-submissions", async (req) => {
    const user = currentUser(req);
    const { status, warehouse } = req.query as { status?: string; warehouse?: string };
    const reviewer = user.role === "admin" || user.role === "warehouse_incharge";
    return listQualitySubmissions({ status, site: await scopedSite(req, warehouse), submittedById: reviewer ? undefined : user.id });
  });

  app.post("/api/quality-submissions/:id/approve", reviewers, async (req) => {
    const id = Number((req.params as { id: string }).id);
    await assertWarehouseAccess(req, await qualitySubmissionWarehouse(id));
    const { destinationBin } = (req.body ?? {}) as { destinationBin?: string };
    await approveQualityCheck(currentUser(req), id, { destinationBin });
    return { ok: true };
  });

  app.post("/api/quality-submissions/:id/reject", reviewers, async (req) => {
    const id = Number((req.params as { id: string }).id);
    await assertWarehouseAccess(req, await qualitySubmissionWarehouse(id));
    const { reason } = (req.body ?? {}) as { reason?: string };
    await rejectQualityCheck(currentUser(req), id, reason);
    return { ok: true };
  });
}
