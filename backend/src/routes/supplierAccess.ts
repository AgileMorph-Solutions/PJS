import type { FastifyInstance } from "fastify";
import { currentUser, requireRole } from "../auth/plugin.js";
import {
  listBranchManagers, setBranchManagerSuppliers, mySuppliers, requestSupplier,
  listSupplierRequests, approveSupplierRequest, rejectSupplierRequest,
} from "../services/supplierAccess.js";

export async function supplierAccessRoutes(app: FastifyInstance) {
  const reviewers = { preHandler: requireRole("admin", "warehouse_incharge") };

  app.get("/api/branch-managers", reviewers, async (req) => listBranchManagers(currentUser(req)));

  app.put("/api/branch-managers/:id/suppliers", reviewers, async (req) => {
    const { id } = req.params as { id: string };
    const { codes } = (req.body ?? {}) as { codes?: string[] };
    await setBranchManagerSuppliers(currentUser(req), id, Array.isArray(codes) ? codes : []);
    return { ok: true };
  });

  app.get("/api/my-suppliers", { preHandler: requireRole("branch_manager") }, async (req) => mySuppliers(currentUser(req)));

  app.post("/api/supplier-requests", { preHandler: requireRole("branch_manager") }, async (req, reply) => {
    const { name, code } = (req.body ?? {}) as { name?: string; code?: string };
    return reply.code(201).send(await requestSupplier(currentUser(req), name, code));
  });

  app.get("/api/supplier-requests", async (req) => {
    const { status } = req.query as { status?: string };
    return listSupplierRequests(currentUser(req), status);
  });

  app.post("/api/supplier-requests/:id/approve", reviewers, async (req) => {
    const { id } = req.params as { id: string };
    const { code } = (req.body ?? {}) as { code?: string };
    await approveSupplierRequest(currentUser(req), id, code);
    return { ok: true };
  });

  app.post("/api/supplier-requests/:id/reject", reviewers, async (req) => {
    const { id } = req.params as { id: string };
    const { reason } = (req.body ?? {}) as { reason?: string };
    await rejectSupplierRequest(currentUser(req), id, reason);
    return { ok: true };
  });
}
