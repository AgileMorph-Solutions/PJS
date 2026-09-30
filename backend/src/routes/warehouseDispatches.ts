import type { FastifyInstance } from "fastify";
import { listWarehouseDispatchLines } from "../services/warehouseDispatches.js";
import { scopedSite } from "../auth/scope.js";

export async function warehouseDispatchRoutes(app: FastifyInstance) {
  app.get("/api/warehouse-dispatches", async (req) => {
    const { warehouse } = req.query as { warehouse?: string };
    return listWarehouseDispatchLines(await scopedSite(req, warehouse));
  });
}
