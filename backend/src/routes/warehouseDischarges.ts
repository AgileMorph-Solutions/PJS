import type { FastifyInstance } from "fastify";
import { listWarehouseDischarges } from "../services/warehouseDischarges.js";
import { scopedSite } from "../auth/scope.js";

export async function warehouseDischargeRoutes(app: FastifyInstance) {
  app.get("/api/warehouse-discharges", async (req) => {
    const { warehouse } = req.query as { warehouse?: string };
    return listWarehouseDischarges(await scopedSite(req, warehouse));
  });
}
