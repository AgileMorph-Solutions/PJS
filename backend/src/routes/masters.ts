// Mirrors masters / addSupplier / addWarehouse / addBin on TrackingApi. Origins have no "add"
// endpoint on the frontend today either (the master list is read-only there) — kept the same
// here, on purpose, not an oversight.
import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

export async function masterRoutes(app: FastifyInstance) {
  app.get("/api/masters", async () => {
    const [suppliers, warehouses, bins, origins] = await Promise.all([
      prisma.supplier.findMany({ orderBy: { code: "asc" } }),
      prisma.warehouse.findMany({ orderBy: { name: "asc" } }),
      prisma.bin.findMany({ orderBy: { code: "asc" } }),
      prisma.origin.findMany({ orderBy: { name: "asc" } }),
    ]);
    return {
      suppliers,
      warehouses: warehouses.map((w) => w.name),
      bins: bins.map((b) => b.code),
      origins: origins.map((o) => o.name),
    };
  });

  app.post("/api/masters/suppliers", async (req, reply) => {
    const { code, name } = req.body as { code: string; name: string };
    if (!code || !name) return reply.code(400).send({ error: "code and name are required" });
    const supplier = await prisma.supplier.upsert({ where: { code }, update: { name }, create: { code, name } });
    return reply.code(201).send(supplier);
  });

  app.post("/api/masters/warehouses", async (req, reply) => {
    const { name } = req.body as { name: string };
    if (!name) return reply.code(400).send({ error: "name is required" });
    const warehouse = await prisma.warehouse.upsert({ where: { name }, update: {}, create: { name } });
    return reply.code(201).send(warehouse);
  });

  app.post("/api/masters/bins", async (req, reply) => {
    const { code, warehouseName } = req.body as { code: string; warehouseName?: string };
    if (!code) return reply.code(400).send({ error: "code is required" });
    const bin = await prisma.bin.upsert({
      where: { code },
      update: { warehouseName: warehouseName ?? undefined },
      create: { code, warehouseName },
    });
    return reply.code(201).send(bin);
  });
}
