/**
 * Mirrors the ReceiptRecord methods on TrackingApi (frontend/src/state/TrackingContext.tsx):
 * createReceipt, updateReceiptField, setStageField, setBranch, plus the list/get reads the
 * frontend used to get for free from state.receipts.
 *
 * All the real work is in services/receipts.ts, which the seeder shares.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DECISION_BRANCHES } from "@anagroci/contract/domain/decisions";
import { STAGE_FIELD_MAP } from "@anagroci/contract/generated/stageFieldMap";
import type { ReceiptRecord } from "@anagroci/contract/types/receipt";
import { ValidationError } from "../domain/validation.js";
import { UnknownStageFieldError } from "../stageStore.js";
import {
  listReceipts, getReceipt, createReceipt, patchReceipt, setStageFields, setBranch, getReceiptActivities,
} from "../services/receipts.js";
import { createReceiptsBatch } from "../services/receiptBatch.js";
import { getReceiptLinks } from "../services/receiptLinks.js";
import { getDownstreamStatus } from "../services/receiptsDownstream.js";
import { approveException, getReceiptPlanInfo, linkReceiptToPlan, listReceiptPlanInfo } from "../services/receiptPlanInfo.js";
import { warningsForReceipt } from "../domain/dataQuality/index.js";
import { scopedSite, scopedWarehouse, assertWarehouseAccess } from "../auth/scope.js";
import { currentUser } from "../auth/plugin.js";
import { assertReceiptVisible, filterReceiptsForUser } from "../auth/receiptAccess.js";

/** Hard rules reject (422); unknown stage/field is a client bug (400). */
export function sendError(reply: any, e: unknown) {
  if (e instanceof ValidationError) return reply.code(422).send({ error: e.message });
  if (e instanceof UnknownStageFieldError) return reply.code(400).send({ error: e.message });
  throw e;
}

/**
 * Every mutating receipt route needs "does this id exist" first — five of them repeated the same
 * lookup-or-404. Centralised so the message and status code can't drift between them.
 */
async function requireReceipt(id: string, reply: FastifyReply, req: FastifyRequest): Promise<ReceiptRecord | null> {
  const r = await getReceipt(id);
  if (!r) {
    reply.code(404).send({ error: `Receipt ${id} not found` });
    return null;
  }
  // Warehouse and (for Branch Managers) supplier visibility, checked in one place so no receipt
  // route can forget it.
  await assertWarehouseAccess(req, r.warehouse);
  await assertReceiptVisible(currentUser(req), r);
  return r;
}

export async function receiptRoutes(app: FastifyInstance) {
  app.get("/api/receipts", async (req) => {
    const { warehouse } = req.query as { warehouse?: string };
    return filterReceiptsForUser(currentUser(req), await listReceipts(await scopedSite(req, warehouse)));
  });

  /**
   * Per-receipt dispatched/received/dried/issued flags for Reception's status column — the reason
   * Dispatch to Central, Receiving from Unit and Issue to Production no longer need their own
   * sidebar pages (see services/receiptsDownstream.ts's header).
   */
  app.get("/api/receipts/downstream", async (req) => {
    const { warehouse } = req.query as { warehouse?: string };
    const status = await getDownstreamStatus(await scopedSite(req, warehouse));
    return [...status.values()];
  });

  /**
   * Reception Type, exception flags, plan link and approval for every receipt — Reception's list
   * and the receipt page read these instead of recomputing them (services/receiptPlanInfo.ts).
   * Warehouse Incharge / admin only: auth/policy.ts keeps the narrow roles off it.
   */
  app.get("/api/receipts/plan-info", async (req) => {
    const { warehouse } = req.query as { warehouse?: string };
    return listReceiptPlanInfo(await scopedSite(req, warehouse));
  });

  app.get("/api/receipts/:id/plan-info", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await requireReceipt(id, reply, req))) return;
    return getReceiptPlanInfo(id);
  });

  app.post("/api/receipts/:id/exception-approval", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { note } = (req.body ?? {}) as { note?: string };
    if (!(await requireReceipt(id, reply, req))) return;
    try { return await approveException(id, currentUser(req).id, note); } catch (e) { return sendError(reply, e); }
  });

  app.post("/api/receipts/:id/delivery-plan", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { deliveryPlanId } = (req.body ?? {}) as { deliveryPlanId?: string };
    if (!deliveryPlanId) return reply.code(400).send({ error: "deliveryPlanId is required" });
    if (!(await requireReceipt(id, reply, req))) return;
    try { return await linkReceiptToPlan(id, deliveryPlanId); } catch (e) { return sendError(reply, e); }
  });

  app.get("/api/receipts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    return requireReceipt(id, reply, req);
  });

  app.post("/api/receipts", async (req, reply) => {
    const { warehouse, arrivalDate, deliveryPlanId } = (req.body ?? {}) as { warehouse?: string; arrivalDate?: string; deliveryPlanId?: string };
    try {
      // A Warehouse Incharge can only open receipts at their own warehouse.
      return reply.code(201).send(await createReceipt(scopedWarehouse(req, warehouse) ?? warehouse, arrivalDate, deliveryPlanId));
    } catch (e) { return sendError(reply, e); }
  });

  /**
   * Several trucks at once from the batch grid — all or nothing (services/receiptBatch.ts). Like
   * POST /api/receipts, a Warehouse Incharge is pinned to their own warehouse; an admin names one.
   * (Branch Manager / QFS Officer never reach this: auth/policy.ts doesn't list it for them.)
   */
  app.post("/api/receipts/batch", async (req, reply) => {
    const { warehouse, rows } = (req.body ?? {}) as { warehouse?: string; rows?: unknown };
    const wh = scopedWarehouse(req, warehouse) ?? warehouse;
    if (!wh) return reply.code(400).send({ error: "warehouse is required" });
    const ids = await createReceiptsBatch(wh, rows, currentUser(req).id);
    return reply.code(201).send({ ids });
  });

  app.patch("/api/receipts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await requireReceipt(id, reply, req))) return;
    try {
      const data = await patchReceipt(id, (req.body ?? {}) as Record<string, unknown>, { actor: { id: currentUser(req).id, via: "direct" } });
      return { data, warnings: warningsForReceipt(data) };
    } catch (e) { return sendError(reply, e); }
  });

  /**
   * Batched stage write. Replaces the old per-field PUT: under normalization a per-field write
   * means one upsert per keystroke against the same row, and the frontend coalesces a stage's
   * dirty fields before flushing.
   */
  app.patch("/api/receipts/:id/stages/:stageId", async (req, reply) => {
    const { id, stageId } = req.params as { id: string; stageId: string };
    const { fields } = (req.body ?? {}) as { fields?: Record<string, string> };
    if (!STAGE_FIELD_MAP[stageId]) return reply.code(400).send({ error: `Unknown stage "${stageId}"` });
    if (!fields || typeof fields !== "object") return reply.code(400).send({ error: "body.fields is required" });
    if (!(await requireReceipt(id, reply, req))) return;
    try {
      const data = await setStageFields(id, stageId, fields, { actor: { id: currentUser(req).id, via: "direct" } });
      return { data, warnings: warningsForReceipt(data) };
    } catch (e) { return sendError(reply, e); }
  });

  app.post("/api/receipts/:id/branch", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { stageId, branchId, reason } = (req.body ?? {}) as { stageId: string; branchId: string; reason?: string };

    const known = DECISION_BRANCHES[stageId];
    if (!known || !known.some((b) => b.id === branchId)) {
      return reply.code(400).send({ error: `Unknown branch "${branchId}" for stage "${stageId}"` });
    }
    if (!(await requireReceipt(id, reply, req))) return;
    try {
      const data = await setBranch(id, stageId, branchId, reason, { actor: { id: currentUser(req).id, via: "direct" } });
      return { data, warnings: warningsForReceipt(data) };
    } catch (e) { return sendError(reply, e); }
  });

  /**
   * The full 1:N history for the two stages ReceiptRecord.stageData can only show one row of
   * (n-otheract, n-ledger). Doc §7 wants the activity ledger as a sequence, not disconnected
   * entries — this is that sequence.
   */
  app.get("/api/receipts/:id/activities", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await requireReceipt(id, reply, req))) return;
    return getReceiptActivities(id);
  });

  /**
   * Cross-references this receipt to drying jobs / transfer receipts about the same physical
   * batch, joined on Lot Number (see services/receiptLinks.ts's header for the accuracy tradeoff
   * this accepts vs. joining on FICHE).
   */
  app.get("/api/receipts/:id/links", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await requireReceipt(id, reply, req))) return;
    return getReceiptLinks(id);
  });
}
