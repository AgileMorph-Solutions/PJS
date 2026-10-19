import type { FastifyInstance } from "fastify";
import type { ActivityEntryInput } from "@anagroci/contract/data/warehouseActivities";
import { createActivityEntry, listWarehouseActivityLedger } from "../services/warehouseActivityLedger.js";
import { currentUser } from "../auth/plugin.js";
import { scopedWarehouse } from "../auth/scope.js";

export async function warehouseActivityLedgerRoutes(app: FastifyInstance) {
  app.get("/api/warehouse-activity-ledger", async () => listWarehouseActivityLedger());

  // Recording an activity: Warehouse Incharge / admin only (auth/policy.ts keeps the narrow roles off it), at their own warehouse.
  app.post("/api/warehouse-activity-ledger", async (req, reply) => {
    const body = (req.body ?? {}) as ActivityEntryInput & { warehouse?: string };
    const warehouse = scopedWarehouse(req, body.warehouse) ?? body.warehouse;
    if (!warehouse) return reply.code(400).send({ error: "warehouse is required" });
    return reply.code(201).send(await createActivityEntry(body, warehouse, currentUser(req).id));
  });
}
