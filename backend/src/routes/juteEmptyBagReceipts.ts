import type { FastifyInstance } from "fastify";
import type { EmptyBagReceiptInput } from "@anagroci/contract/domain/juteEmptyBagReceipt";
import { currentUser } from "../auth/plugin.js";
import { scopedSite, scopedWarehouse } from "../auth/scope.js";
import { createEmptyBagReceipt, listEmptyBagReceipts } from "../services/juteEmptyBagReceipts.js";

// Warehouse Incharge / admin only: auth/policy.ts is default-deny for the narrow roles, and neither route is listed there.
export async function juteEmptyBagReceiptRoutes(app: FastifyInstance) {
  app.get("/api/jute-empty-bag-receipts", async (req) => {
    const { warehouse } = req.query as { warehouse?: string };
    return listEmptyBagReceipts(await scopedSite(req, warehouse));
  });

  app.post("/api/jute-empty-bag-receipts", async (req, reply) => {
    const body = (req.body ?? {}) as EmptyBagReceiptInput & { warehouse?: string };
    const warehouse = scopedWarehouse(req, body.warehouse);
    if (!warehouse) return reply.code(400).send({ error: "warehouse is required" });
    return reply.code(201).send(await createEmptyBagReceipt(body, warehouse, currentUser(req).id));
  });
}
