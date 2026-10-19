import type { FastifyInstance } from "fastify";
import { completeDrying, listDryingBatches, type CompleteDryingInput } from "../services/dryingBatches.js";
import { assertWarehouseAccess, scopedSite } from "../auth/scope.js";
import { prisma } from "../db.js";

export async function dryingBatchRoutes(app: FastifyInstance) {
  app.get("/api/drying-batches", async (req) => {
    const { warehouse } = req.query as { warehouse?: string };
    return listDryingBatches(await scopedSite(req, warehouse));
  });

  // What came back from drying. Warehouse Incharge / admin only (auth/policy.ts keeps the narrow roles off it), and only at their own warehouse.
  app.post("/api/drying-batches/:id/complete", async (req, reply) => {
    const { id } = req.params as { id: string };
    const batch = await prisma.dryingBatch.findUnique({ where: { id }, select: { warehouseSite: true } });
    if (!batch) return reply.code(404).send({ error: "Drying batch not found" });
    if (batch.warehouseSite) await assertWarehouseAccess(req, batch.warehouseSite);
    return completeDrying(id, (req.body ?? {}) as CompleteDryingInput);
  });
}
