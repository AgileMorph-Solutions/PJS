/**
 * Production Phase 2: Calibration. Thin, like rcnReceipts.ts. Sizing a load and moving nuts between silos are
 * Admin / Warehouse Incharge for now (the Data Entry role comes later); a QFS Officer reads the batch's
 * calibration and submits a QC-2 sizing check, which the Incharge approves — auth/policy.ts lists those routes.
 */
import type { FastifyInstance } from "fastify";
import type { CalibrationRunInput, ManualCalibrationInput, SizingCheckInput } from "@anagroci/contract/types/calibration";
import { currentUser, requireRole } from "../auth/plugin.js";
import {
  addCalibrationRun, addManualCalibration, batchCalibration, deleteCalibrationRun, reviewSizingCheck, submitSizingCheck,
} from "../services/production/calibration.js";
import { siteFor } from "./productionBatches.js";

export async function calibrationRoutes(app: FastifyInstance) {
  const reviewers = { preHandler: requireRole("admin", "warehouse_incharge") };

  app.get("/api/production/batches/:code/calibration", async (req, reply) => {
    const { code } = req.params as { code: string };
    const found = await batchCalibration(await siteFor(req), code);
    if (!found) return reply.code(404).send({ error: `Batch ${code} not found` });
    return found;
  });

  app.post("/api/production/rcn-receipts/:id/calibration-runs", reviewers, async (req, reply) => {
    const { id } = req.params as { id: string };
    const receipt = await addCalibrationRun(await siteFor(req), currentUser(req).id, id, (req.body ?? {}) as CalibrationRunInput);
    return reply.code(201).send(receipt);
  });

  app.delete("/api/production/calibration-runs/:id", reviewers, async (req) => {
    const { id } = req.params as { id: string };
    return deleteCalibrationRun(await siteFor(req), Number(id));
  });

  app.post("/api/production/sizing-checks", async (req, reply) => {
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
