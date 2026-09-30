import type { FastifyInstance } from "fastify";
import { currentUser, requireRole } from "../auth/plugin.js";
import { assertWarehouseAccess, scopedSite } from "../auth/scope.js";
import { assertReceiptVisible } from "../auth/receiptAccess.js";
import { getReceipt } from "../services/receipts.js";
import {
  submitForm, listSubmissions, approveSubmission, rejectSubmission, submissionWarehouse,
} from "../services/submissions.js";

export async function submissionRoutes(app: FastifyInstance) {
  const reviewers = { preHandler: requireRole("admin", "warehouse_incharge") };

  /** A Branch Manager / QFS Officer submits their role's form for a receipt they can see. */
  app.post("/api/receipts/:id/submissions", async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = currentUser(req);
    const receipt = await getReceipt(id);
    if (!receipt) return reply.code(404).send({ error: `Receipt ${id} not found` });
    await assertWarehouseAccess(req, receipt.warehouse);
    await assertReceiptVisible(user, receipt);
    const { values } = (req.body ?? {}) as { values?: unknown };
    return reply.code(201).send(await submitForm(user, id, values));
  });

  /** Reviewers see their warehouse's submissions; submitters only ever see their own. */
  app.get("/api/submissions", async (req) => {
    const user = currentUser(req);
    const { status, receiptId, warehouse } = req.query as { status?: string; receiptId?: string; warehouse?: string };
    const isReviewer = user.role === "admin" || user.role === "warehouse_incharge";
    return listSubmissions({
      status, receiptId,
      site: await scopedSite(req, warehouse),
      submittedById: isReviewer ? undefined : user.id,
    });
  });

  app.post("/api/submissions/:id/approve", reviewers, async (req) => {
    const { id } = req.params as { id: string };
    await assertWarehouseAccess(req, await submissionWarehouse(id));
    await approveSubmission(currentUser(req), id);
    return { ok: true };
  });

  app.post("/api/submissions/:id/reject", reviewers, async (req) => {
    const { id } = req.params as { id: string };
    const { reason } = (req.body ?? {}) as { reason?: string };
    await assertWarehouseAccess(req, await submissionWarehouse(id));
    await rejectSubmission(currentUser(req), id, reason);
    return { ok: true };
  });
}
