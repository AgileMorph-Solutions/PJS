import type { FastifyInstance } from "fastify";
import { listWarehouseDispatchLines } from "../services/warehouseDispatches.js";
import { resolveSite } from "../domain/site.js";

export async function warehouseDispatchRoutes(app: FastifyInstance) {
  app.get("/api/warehouse-dispatches", async (req) => {
    const { warehouse } = req.query as { warehouse?: string };
    return listWarehouseDispatchLines(warehouse ? await resolveSite(warehouse) : undefined);
  });
}
