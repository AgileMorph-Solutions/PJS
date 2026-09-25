// Mirrors masters / addSupplier / addWarehouse / addBin on TrackingApi. Origins have no "add"
// endpoint on the frontend today either (the master list is read-only there) — kept the same
// here, on purpose, not an oversight.
import type { FastifyInstance } from "fastify";
import type { WarehouseKind } from "@anagroci/contract/data/warehouseKinds";
import { listMasters, addSupplier, addWarehouse, addBin } from "../services/masters.js";

export async function masterRoutes(app: FastifyInstance) {
  app.get("/api/masters", async () => listMasters());

  app.post("/api/masters/suppliers", async (req, reply) => {
    const { code, name } = (req.body ?? {}) as { code?: string; name?: string };
    if (!code || !name) return reply.code(400).send({ error: "code and name are required" });
    return reply.code(201).send(await addSupplier(code, name));
  });

  app.post("/api/masters/warehouses", async (req, reply) => {
    const { name, kind, site } = (req.body ?? {}) as { name?: string; kind?: WarehouseKind; site?: string };
    if (!name) return reply.code(400).send({ error: "name is required" });
    // ValidationError (kind+site both set, or an unknown kind) is mapped to 422 by app.ts's
    // global error handler — no try/catch needed here, same as every other route in this file.
    return reply.code(201).send(await addWarehouse(name, { kind, site }));
  });

  app.post("/api/masters/bins", async (req, reply) => {
    const { code, warehouseName } = (req.body ?? {}) as { code?: string; warehouseName?: string };
    if (!code) return reply.code(400).send({ error: "code is required" });
    return reply.code(201).send(await addBin(code, warehouseName));
  });
}
