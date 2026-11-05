import type { FastifyInstance } from "fastify";
import type { VendorReceiptInput } from "@anagroci/contract/domain/juteVendorReceipt";
import { currentUser } from "../auth/plugin.js";
import { scopedSite, scopedWarehouse } from "../auth/scope.js";
import { createVendorReceipt, listVendorReceipts } from "../services/juteVendorReceipts.js";

// Warehouse Incharge / admin only: auth/policy.ts is default-deny for the narrow roles, and neither route is listed there.
export async function juteVendorReceiptRoutes(app: FastifyInstance) {
  app.get("/api/jute-vendor-receipts", async (req) => {
    const { warehouse } = req.query as { warehouse?: string };
    return listVendorReceipts(await scopedSite(req, warehouse));
  });

  app.post("/api/jute-vendor-receipts", async (req, reply) => {
    const body = (req.body ?? {}) as VendorReceiptInput & { warehouse?: string };
    const warehouse = scopedWarehouse(req, body.warehouse);
    if (!warehouse) return reply.code(400).send({ error: "warehouse is required" });
    return reply.code(201).send(await createVendorReceipt(body, warehouse, currentUser(req).id));
  });
}
