/**
 * Production Phase 1, steps 1–4: RCN Receipts, their moisture checks and their weighing. Thin, like
 * productionBatches.ts. Creating a receipt and weighing it are Admin / Warehouse Incharge for now (the Data
 * Entry role comes later); a QFS Officer may read and submit a moisture check — auth/policy.ts lists exactly
 * those routes for them.
 */
import type { FastifyInstance } from "fastify";
import type { MoistureCheckInput, RcnFinalWeightInput, RcnPalletInput, RcnReceiptInput } from "@anagroci/contract/types/rcnReceipt";
import { currentUser, requireRole } from "../auth/plugin.js";
import { createRcnReceipt, listRcnReceipts, reviewMoistureCheck, submitMoistureCheck } from "../services/production/rcnReceipts.js";
import { addPallet, deletePallet, saveFinalWeight, updatePallet } from "../services/production/rcnWeighing.js";
import { siteFor } from "./productionBatches.js";

export async function rcnReceiptRoutes(app: FastifyInstance) {
  const reviewers = { preHandler: requireRole("admin", "warehouse_incharge") };

  app.get("/api/production/rcn-receipts", async (req) => {
    const { batch } = req.query as { batch?: string };
    return listRcnReceipts(await siteFor(req), batch || undefined);
  });

  app.post("/api/production/rcn-receipts", async (req, reply) => {
    const created = await createRcnReceipt(await siteFor(req), currentUser(req).id, (req.body ?? {}) as RcnReceiptInput);
    return reply.code(201).send(created);
  });

  app.post("/api/production/rcn-receipts/:id/moisture-checks", async (req, reply) => {
    const { id } = req.params as { id: string };
    const receipt = await submitMoistureCheck(await siteFor(req), currentUser(req), id, (req.body ?? {}) as MoistureCheckInput);
    return reply.code(201).send(receipt);
  });

  app.post("/api/production/moisture-checks/:id/approve", reviewers, async (req) => {
    const { id } = req.params as { id: string };
    return reviewMoistureCheck(await siteFor(req), currentUser(req).id, Number(id), true);
  });

  app.post("/api/production/moisture-checks/:id/reject", reviewers, async (req) => {
    const { id } = req.params as { id: string };
    const { reason } = (req.body ?? {}) as { reason?: string };
    return reviewMoistureCheck(await siteFor(req), currentUser(req).id, Number(id), false, reason);
  });

  app.post("/api/production/rcn-receipts/:id/pallets", async (req, reply) => {
    const { id } = req.params as { id: string };
    const receipt = await addPallet(await siteFor(req), currentUser(req).id, id, (req.body ?? {}) as RcnPalletInput);
    return reply.code(201).send(receipt);
  });

  app.put("/api/production/rcn-pallets/:id", async (req) => {
    const { id } = req.params as { id: string };
    return updatePallet(await siteFor(req), Number(id), (req.body ?? {}) as RcnPalletInput);
  });

  app.delete("/api/production/rcn-pallets/:id", async (req) => {
    const { id } = req.params as { id: string };
    return deletePallet(await siteFor(req), Number(id));
  });

  app.post("/api/production/rcn-receipts/:id/final-weight", async (req) => {
    const { id } = req.params as { id: string };
    return saveFinalWeight(await siteFor(req), currentUser(req).id, id, (req.body ?? {}) as RcnFinalWeightInput);
  });
}
