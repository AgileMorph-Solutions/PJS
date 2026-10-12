// Mirrors masters / addSupplier / addWarehouse / addBin on TrackingApi. Origins have no "add"
// endpoint on the frontend today either (the master list is read-only there) — kept the same
// here, on purpose, not an oversight.
import type { FastifyInstance } from "fastify";
import type { WarehouseKind } from "@anagroci/contract/data/warehouseKinds";
import type { WarehouseType } from "@anagroci/contract/data/warehouseTypes";
import { requireRole } from "../auth/plugin.js";
import { listMasters, createSupplier, updateSupplier, removeSupplier, setSupplierActive, suggestSupplierCode, supplierReferences, addWarehouse, addBin, setWarehouseType, setWarehouseCode } from "../services/masters.js";

export async function masterRoutes(app: FastifyInstance) {
  app.get("/api/masters", async () => listMasters());

  // Admin and Warehouse Incharge only (auth/policy.ts keeps the narrow roles off every /api/masters write).
  app.get("/api/masters/suppliers/suggest-code", async (req, reply) => {
    const { name } = req.query as { name?: string };
    if (!name?.trim()) return reply.code(400).send({ error: "name is required" });
    return { code: await suggestSupplierCode(name) };
  });

  app.post("/api/masters/suppliers", async (req, reply) => {
    const { code, name } = (req.body ?? {}) as { code?: string; name?: string };
    if (!name?.trim()) return reply.code(400).send({ error: "name is required" });
    return reply.code(201).send(await createSupplier({ code, name }));
  });

  app.patch("/api/masters/suppliers/:code", async (req) => {
    const { code } = req.params as { code: string };
    return updateSupplier(code, (req.body ?? {}) as { name?: string; code?: string });
  });

  app.get("/api/masters/suppliers/:code/references", async (req) => supplierReferences((req.params as { code: string }).code));

  app.post("/api/masters/suppliers/:code/active", async (req) => {
    const { code } = req.params as { code: string };
    const { active } = (req.body ?? {}) as { active?: boolean };
    return setSupplierActive(code, active !== false);
  });

  app.delete("/api/masters/suppliers/:code", async (req) => removeSupplier((req.params as { code: string }).code));

  app.post("/api/masters/warehouses", async (req, reply) => {
    const { name, kind, site, type } = (req.body ?? {}) as { name?: string; kind?: WarehouseKind; site?: string; type?: WarehouseType };
    if (!name) return reply.code(400).send({ error: "name is required" });
    // ValidationError (kind+site both set, or an unknown kind) is mapped to 422 by app.ts's
    // global error handler — no try/catch needed here, same as every other route in this file.
    return reply.code(201).send(await addWarehouse(name, { kind, site, type }));
  });

  // Either field on its own: sending only `code` must not clear the type (and vice versa).
  app.patch("/api/masters/warehouses/:name", { preHandler: requireRole("admin") }, async (req) => {
    const { name } = req.params as { name: string };
    const body = (req.body ?? {}) as { type?: string | null; code?: string | null };
    let result: unknown;
    if ("code" in body) result = await setWarehouseCode(name, body.code ?? null);
    if ("type" in body || !("code" in body)) result = await setWarehouseType(name, body.type ?? null);
    return result;
  });

  app.post("/api/masters/bins", async (req, reply) => {
    const { code, warehouseName } = (req.body ?? {}) as { code?: string; warehouseName?: string };
    if (!code) return reply.code(400).send({ error: "code is required" });
    return reply.code(201).send(await addBin(code, warehouseName));
  });
}
