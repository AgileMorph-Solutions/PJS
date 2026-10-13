// The supplier register: list rows come from /api/masters (lean, every role); everything here, including the
// supplier page with its contact and bank details, is for admin and Warehouse Incharge only.
import type { FastifyInstance } from "fastify";
import { currentUser, requireRole } from "../auth/plugin.js";
import {
  createSupplier, getSupplierDetail, removeSupplier, suggestSupplierCode, supplierReferences, updateSupplier, type SupplierInput,
} from "../services/suppliers.js";

export async function supplierRoutes(app: FastifyInstance) {
  const staff = { preHandler: requireRole("admin", "warehouse_incharge") };

  app.get("/api/masters/suppliers/suggest-code", staff, async (req, reply) => {
    const { name } = req.query as { name?: string };
    if (!name?.trim()) return reply.code(400).send({ error: "name is required" });
    return { code: await suggestSupplierCode(name) };
  });

  app.get("/api/masters/suppliers/:code", staff, async (req, reply) => {
    const detail = await getSupplierDetail((req.params as { code: string }).code);
    return detail ?? reply.code(404).send({ error: "Supplier not found" });
  });

  app.get("/api/masters/suppliers/:code/references", staff, async (req) => supplierReferences((req.params as { code: string }).code));

  app.post("/api/masters/suppliers", staff, async (req, reply) =>
    reply.code(201).send(await createSupplier((req.body ?? {}) as SupplierInput, currentUser(req).id)));

  app.patch("/api/masters/suppliers/:code", staff, async (req) =>
    updateSupplier((req.params as { code: string }).code, (req.body ?? {}) as SupplierInput, currentUser(req).id));

  app.delete("/api/masters/suppliers/:code", staff, async (req) => removeSupplier((req.params as { code: string }).code, currentUser(req).id));
}
