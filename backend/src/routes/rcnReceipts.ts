/**
 * Production Phase 1, steps 1–4: RCN Receipts, their moisture checks and their weighing, then production's acceptance.
 * Thin, like productionBatches.ts. The load is the warehouse's until production accepts it (Lokesh, 16 Nov 2026, "Option
 * 1"): Admin / Warehouse Incharge record and weigh it and approve its moisture check, a QFS Officer may submit one, and
 * Admin / Production Incharge accept it. auth/policy.ts opens these routes to the narrower roles.
 */
import type { FastifyInstance } from "fastify";
import type { MoistureCheckInput, RcnFinalWeightInput, RcnPalletInput, RcnReceiptInput } from "@anagroci/contract/types/rcnReceipt";
import { currentUser, requireRole } from "../auth/plugin.js";
import { acceptRcnReceipt, createRcnReceipt, listRcnReceipts, reviewMoistureCheck, setRcnCropYear, submitMoistureCheck } from "../services/production/rcnReceipts.js";
import { addPallet, deletePallet, saveFinalWeight, updatePallet } from "../services/production/rcnWeighing.js";
import { siteFor } from "./productionBatches.js";

export async function rcnReceiptRoutes(app: FastifyInstance) {
  const warehouse = { preHandler: requireRole("admin", "warehouse_incharge") };
  const checkers = { preHandler: requireRole("admin", "warehouse_incharge", "qfs_officer") };
  const production = { preHandler: requireRole("admin", "production_incharge") };

  app.get("/api/production/rcn-receipts", async (req) => {
    const { batch } = req.query as { batch?: string };
    return listRcnReceipts(await siteFor(req), batch || undefined);
  });

  app.post("/api/production/rcn-receipts", warehouse, async (req, reply) => {
    const created = await createRcnReceipt(await siteFor(req), currentUser(req).id, (req.body ?? {}) as RcnReceiptInput);
    return reply.code(201).send(created);
  });

  app.put("/api/production/rcn-receipts/:id/crop-year", warehouse, async (req) => {
    const { id } = req.params as { id: string };
    const { cropYear } = (req.body ?? {}) as { cropYear?: string };
    return setRcnCropYear(await siteFor(req), id, cropYear);
  });

  app.post("/api/production/rcn-receipts/:id/moisture-checks", checkers, async (req, reply) => {
    const { id } = req.params as { id: string };
    const receipt = await submitMoistureCheck(await siteFor(req), currentUser(req), id, (req.body ?? {}) as MoistureCheckInput);
    return reply.code(201).send(receipt);
  });

  app.post("/api/production/moisture-checks/:id/approve", warehouse, async (req) => {
    const { id } = req.params as { id: string };
    return reviewMoistureCheck(await siteFor(req), currentUser(req).id, Number(id), true);
  });

  app.post("/api/production/moisture-checks/:id/reject", warehouse, async (req) => {
    const { id } = req.params as { id: string };
    const { reason } = (req.body ?? {}) as { reason?: string };
    return reviewMoistureCheck(await siteFor(req), currentUser(req).id, Number(id), false, reason);
  });

  app.post("/api/production/rcn-receipts/:id/pallets", warehouse, async (req, reply) => {
    const { id } = req.params as { id: string };
    const receipt = await addPallet(await siteFor(req), currentUser(req), id, (req.body ?? {}) as RcnPalletInput);
    return reply.code(201).send(receipt);
  });

  app.put("/api/production/rcn-pallets/:id", warehouse, async (req) => {
    const { id } = req.params as { id: string };
    return updatePallet(await siteFor(req), currentUser(req), Number(id), (req.body ?? {}) as RcnPalletInput);
  });

  app.delete("/api/production/rcn-pallets/:id", warehouse, async (req) => {
    const { id } = req.params as { id: string };
    return deletePallet(await siteFor(req), currentUser(req), Number(id));
  });

  app.post("/api/production/rcn-receipts/:id/final-weight", warehouse, async (req) => {
    const { id } = req.params as { id: string };
    return saveFinalWeight(await siteFor(req), currentUser(req), id, (req.body ?? {}) as RcnFinalWeightInput);
  });

  app.post("/api/production/rcn-receipts/:id/accept", production, async (req) => {
    const { id } = req.params as { id: string };
    return acceptRcnReceipt(await siteFor(req), currentUser(req), id);
  });
}
