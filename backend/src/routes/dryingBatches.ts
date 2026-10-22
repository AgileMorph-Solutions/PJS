import type { FastifyInstance } from "fastify";
import { checkDrying, listDryingBatches, returnDrying, type CheckDryingInput, type ReturnDryingInput } from "../services/dryingBatches.js";
import { currentUser } from "../auth/plugin.js";
import { sendError } from "./receipts.js";
import { assertWarehouseAccess, scopedSite } from "../auth/scope.js";
import { prisma } from "../db.js";

export async function dryingBatchRoutes(app: FastifyInstance) {
  app.get("/api/drying-batches", async (req) => {
    const { warehouse } = req.query as { warehouse?: string };
    return listDryingBatches(await scopedSite(req, warehouse));
  });

  // A sun-drying round's return and its quality check. Warehouse Incharge / admin only (auth/policy.ts keeps the narrow roles off
  // them), and only at their own warehouse.
  const withBatch = async (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
    const { id } = req.params as { id: string };
    const batch = await prisma.dryingBatch.findUnique({ where: { id }, select: { warehouseSite: true } });
    if (!batch) { reply.code(404).send({ error: "Drying batch not found" }); return null; }
    if (batch.warehouseSite) await assertWarehouseAccess(req, batch.warehouseSite);
    return id;
  };
  app.post("/api/drying-batches/:id/return", async (req, reply) => {
    const id = await withBatch(req, reply);
    if (!id) return;
    try { return await returnDrying(id, (req.body ?? {}) as ReturnDryingInput, currentUser(req)); } catch (e) { return sendError(reply, e); }
  });
  app.post("/api/drying-batches/:id/check", async (req, reply) => {
    const id = await withBatch(req, reply);
    if (!id) return;
    try { return await checkDrying(id, (req.body ?? {}) as CheckDryingInput, currentUser(req)); } catch (e) { return sendError(reply, e); }
  });
}
