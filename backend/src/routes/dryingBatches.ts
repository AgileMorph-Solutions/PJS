import type { FastifyInstance } from "fastify";
import { listDryingBatches } from "../services/dryingBatches.js";
import { resolveSite } from "../domain/site.js";

export async function dryingBatchRoutes(app: FastifyInstance) {
  app.get("/api/drying-batches", async (req) => {
    const { warehouse } = req.query as { warehouse?: string };
    return listDryingBatches(warehouse ? await resolveSite(warehouse) : undefined);
  });
}
