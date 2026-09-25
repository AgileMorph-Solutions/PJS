/**
 * Mirrors the ReceiptRecord methods on TrackingApi (frontend/src/state/TrackingContext.tsx):
 * createReceipt, updateReceiptField, setStageField, setBranch, plus the list/get reads the
 * frontend used to get for free from state.receipts.
 *
 * All the real work is in services/receipts.ts, which the seeder shares.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { DECISION_BRANCHES } from "@anagroci/contract/domain/decisions";
import { STAGE_FIELD_MAP } from "@anagroci/contract/generated/stageFieldMap";
import type { ReceiptRecord } from "@anagroci/contract/types/receipt";
import { ValidationError } from "../domain/validation.js";
import { UnknownStageFieldError } from "../stageStore.js";
import {
  listReceipts, getReceipt, createReceipt, patchReceipt, setStageFields, setBranch, getReceiptActivities,
} from "../services/receipts.js";
import { getReceiptLinks } from "../services/receiptLinks.js";
import { warningsForReceipt } from "../domain/dataQuality/index.js";
import { resolveSite } from "../domain/site.js";

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
async function requireReceipt(id: string, reply: FastifyReply): Promise<ReceiptRecord | null> {
  const r = await getReceipt(id);
  if (!r) {
    reply.code(404).send({ error: `Receipt ${id} not found` });
    return null;
  }
  return r;
}

export async function receiptRoutes(app: FastifyInstance) {
  app.get("/api/receipts", async (req) => {
    const { warehouse } = req.query as { warehouse?: string };
    return listReceipts(warehouse ? await resolveSite(warehouse) : undefined);
  });

  app.get("/api/receipts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    return requireReceipt(id, reply);
  });

  app.post("/api/receipts", async (req, reply) => {
    const { warehouse } = (req.body ?? {}) as { warehouse?: string };
    try {
      return reply.code(201).send(await createReceipt(warehouse));
    } catch (e) { return sendError(reply, e); }
  });

  app.patch("/api/receipts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await requireReceipt(id, reply))) return;
    try {
      const data = await patchReceipt(id, (req.body ?? {}) as Record<string, unknown>);
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
    if (!(await requireReceipt(id, reply))) return;
    try {
      const data = await setStageFields(id, stageId, fields);
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
    if (!(await requireReceipt(id, reply))) return;
    try {
      const data = await setBranch(id, stageId, branchId, reason);
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
    if (!(await requireReceipt(id, reply))) return;
    return getReceiptActivities(id);
  });

  /**
   * Cross-references this receipt to drying jobs / transfer receipts about the same physical
   * batch, joined on Lot Number (see services/receiptLinks.ts's header for the accuracy tradeoff
   * this accepts vs. joining on FICHE).
   */
  app.get("/api/receipts/:id/links", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await requireReceipt(id, reply))) return;
    return getReceiptLinks(id);
  });
}
