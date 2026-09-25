import type { FastifyInstance } from "fastify";
import { listWarehouseActivityLedger } from "../services/warehouseActivityLedger.js";

export async function warehouseActivityLedgerRoutes(app: FastifyInstance) {
  app.get("/api/warehouse-activity-ledger", async () => listWarehouseActivityLedger());
}
