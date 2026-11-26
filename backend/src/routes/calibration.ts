/**
 * Production Phase 2: Calibration. Thin, like rcnReceipts.ts. A load needs no route of its own here: production's
 * acceptance puts it into the silos (rcnReceipts). Calibration is the factory's side, after that acceptance: the
 * production team sees it, and the Production Incharge (or Admin) takes its QC-2 checks and moves nuts between silos.
 * The warehouse team never reaches it (18 Nov 2026).
 */
import type { FastifyInstance } from "fastify";
import type { ManualCalibrationInput, SizingCheckInput } from "@anagroci/contract/types/calibration";
import { currentUser, requireRole } from "../auth/plugin.js";
import { addManualCalibration, batchCalibration, reviewSizingCheck, submitSizingCheck } from "../services/production/calibration.js";
import { siteFor } from "./productionBatches.js";

export async function calibrationRoutes(app: FastifyInstance) {
  const reviewers = { preHandler: requireRole("admin", "production_incharge") };
  // The factory is the production team's to see (canSeeFactory): the warehouse team sees its loads, nothing after.
  const watchers = { preHandler: requireRole("admin", "production_incharge", "factory_manager", "qfs_officer") };
  // A QFS Officer's sample waits for the Production Incharge (submitSizingCheckIn); theirs or an Admin's is approved as saved.
  const checkers = { preHandler: requireRole("admin", "production_incharge", "qfs_officer") };

  app.get("/api/production/batches/:code/calibration", watchers, async (req, reply) => {
    const { code } = req.params as { code: string };
    const found = await batchCalibration(await siteFor(req), code);
    if (!found) return reply.code(404).send({ error: `Batch ${code} not found` });
    return found;
  });

  app.post("/api/production/sizing-checks", checkers, async (req, reply) => {
    const check = await submitSizingCheck(await siteFor(req), currentUser(req), (req.body ?? {}) as SizingCheckInput);
    return reply.code(201).send(check);
  });

  app.post("/api/production/sizing-checks/:id/approve", reviewers, async (req) => {
    const { id } = req.params as { id: string };
    return reviewSizingCheck(await siteFor(req), currentUser(req).id, Number(id), true);
  });

  app.post("/api/production/sizing-checks/:id/reject", reviewers, async (req) => {
    const { id } = req.params as { id: string };
    const { reason } = (req.body ?? {}) as { reason?: string };
    return reviewSizingCheck(await siteFor(req), currentUser(req).id, Number(id), false, reason);
  });

  app.post("/api/production/sizing-checks/:id/manual-calibrations", reviewers, async (req, reply) => {
    const { id } = req.params as { id: string };
    const check = await addManualCalibration(await siteFor(req), currentUser(req).id, Number(id), (req.body ?? {}) as ManualCalibrationInput);
    return reply.code(201).send(check);
  });
}
