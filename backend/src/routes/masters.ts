// Mirrors masters / addSupplier / addWarehouse / addBin on TrackingApi. Origins have no "add"
// endpoint on the frontend today either (the master list is read-only there) — kept the same
// here, on purpose, not an oversight.
import type { FastifyInstance } from "fastify";
import { listMasters, addSupplier, addWarehouse, addBin } from "../services/masters.js";

export async function masterRoutes(app: FastifyInstance) {
  app.get("/api/masters", async () => listMasters());

  app.post("/api/masters/suppliers", async (req, reply) => {
    const { code, name } = (req.body ?? {}) as { code?: string; name?: string };
    if (!code || !name) return reply.code(400).send({ error: "code and name are required" });
    return reply.code(201).send(await addSupplier(code, name));
  });

  app.post("/api/masters/warehouses", async (req, reply) => {
    const { name } = (req.body ?? {}) as { name?: string };
    if (!name) return reply.code(400).send({ error: "name is required" });
    return reply.code(201).send(await addWarehouse(name));
  });

  app.post("/api/masters/bins", async (req, reply) => {
    const { code, warehouseName } = (req.body ?? {}) as { code?: string; warehouseName?: string };
    if (!code) return reply.code(400).send({ error: "code is required" });
    return reply.code(201).send(await addBin(code, warehouseName));
  });
}
