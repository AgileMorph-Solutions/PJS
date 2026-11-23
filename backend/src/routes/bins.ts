import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getSiteBin, listSiteBins } from "../services/bins.js";
import { startBinDrying, type StartBinDryingInput } from "../services/dryingBatches.js";
import { setBinStageFields } from "../services/binStages.js";
import { currentUser } from "../auth/plugin.js";
import { scopedSite } from "../auth/scope.js";
import { sendError } from "./receipts.js";

/**
 * Warehouse activities, per Bin. Warehouse Incharge / admin only (auth/policy.ts lets the narrow roles reach none of these),
 * and always for one warehouse: theirs, or the one an admin names with ?warehouse=.
 */
export async function binRoutes(app: FastifyInstance) {
  const site = async (req: FastifyRequest, reply: FastifyReply) => {
    const { warehouse } = req.query as { warehouse?: string };
    const names = await scopedSite(req, warehouse);
    if (!names) { reply.code(400).send({ error: "warehouse is required" }); return null; }
    return names;
  };

  app.get("/api/bins", async (req, reply) => {
    const names = await site(req, reply);
    if (!names) return;
    // ?unassigned=1: the master's Bins with no warehouse, instead of this warehouse's own.
    return listSiteBins(names, { unassigned: (req.query as { unassigned?: string }).unassigned === "1" });
  });

  app.get("/api/bins/:code", async (req, reply) => {
    const names = await site(req, reply);
    if (!names) return;
    const bin = await getSiteBin(names, (req.params as { code: string }).code);
    return bin ?? reply.code(404).send({ error: "That Bin isn't one of this warehouse's." });
  });

  // One of the Bin's own forms (Other warehouse activities, Activity ledger): { fields: { label: value } }.
  app.put("/api/bins/:code/stages/:stageId", async (req, reply) => {
    const names = await site(req, reply);
    if (!names) return;
    const { code, stageId } = req.params as { code: string; stageId: string };
    try {
      await setBinStageFields(names, code, stageId, ((req.body ?? {}) as { fields?: Record<string, unknown> }).fields ?? {}, currentUser(req));
      return await getSiteBin(names, code);
    } catch (e) { return sendError(reply, e); }
  });

  // Sun drying from this Bin: round 1 of a drying. Its return and quality check are the drying-batches routes.
  app.post("/api/bins/:code/drying", async (req, reply) => {
    const names = await site(req, reply);
    if (!names) return;
    try {
      return reply.code(201).send(await startBinDrying((req.params as { code: string }).code, names, (req.body ?? {}) as StartBinDryingInput, currentUser(req)));
    } catch (e) { return sendError(reply, e); }
  });
}
