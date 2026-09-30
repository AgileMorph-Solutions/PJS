import type { FastifyInstance } from "fastify";
import { listDryingBatches } from "../services/dryingBatches.js";
import { scopedSite } from "../auth/scope.js";

export async function dryingBatchRoutes(app: FastifyInstance) {
  app.get("/api/drying-batches", async (req) => {
    const { warehouse } = req.query as { warehouse?: string };
    return listDryingBatches(await scopedSite(req, warehouse));
  });
}
