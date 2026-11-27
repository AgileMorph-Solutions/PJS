/**
 * Live quality requests (27 Nov 2026): the Incharge's open drying form asks the QFS Officer (contract
 * domain/qualityRequests.ts). Thin: the work is in services/qualityRequests.ts.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { QUALITY_CHECK_TAKERS } from "@anagroci/contract/data/roles";
import { currentUser, requireRole } from "../auth/plugin.js";
import { assertWarehouseAccess } from "../auth/scope.js";
import { prisma } from "../db.js";
import {
  answerQualityRequest, cancelQualityRequest, findLiveRequest, getQualityRequest, openQualityRequest, qualityRequestWarehouse, readScope, requestTarget,
} from "../services/qualityRequests.js";

const idOf = (req: FastifyRequest) => Number((req.params as { id: string }).id);

export async function qualityRequestRoutes(app: FastifyInstance) {
  // The forms that ask are the Incharge's (and an Admin's); the QFS Officer answers.
  const askers = { preHandler: requireRole("admin", "warehouse_incharge") };
  const takers = { preHandler: requireRole(...QUALITY_CHECK_TAKERS) };
  const own = async (req: FastifyRequest) => { await assertWarehouseAccess(req, await qualityRequestWarehouse(idOf(req))); };
  const scoped = async (req: FastifyRequest, body: { kind?: unknown; scope?: unknown } | undefined) => {
    const read = readScope(body?.kind, body?.scope);
    await assertWarehouseAccess(req, (await requestTarget(prisma, read.scope)).warehouse);
    return read;
  };

  /** The form opened. */
  app.post("/api/quality-requests", askers, async (req) => {
    const { kind, scope } = await scoped(req, req.body as { kind?: unknown; scope?: unknown } | undefined);
    return openQualityRequest(currentUser(req), kind, scope);
  });

  /** The form still open for a truck, Bin or round (null when none): the page opens it again. */
  app.post("/api/quality-requests/find", askers, async (req) => {
    const { kind, scope } = await scoped(req, req.body as { kind?: unknown; scope?: unknown } | undefined);
    return { request: await findLiveRequest(kind, scope) };
  });

  app.get("/api/quality-requests/:id", askers, async (req) => { await own(req); return getQualityRequest(idOf(req)); });

  /** The Incharge clicked Cancel: the only way a request ends without the form being saved. */
  app.post("/api/quality-requests/:id/cancel", askers, async (req) => { await own(req); return cancelQualityRequest(currentUser(req), idOf(req)); });

  /** The QFS Officer's reading for the form: sent to Approvals. */
  app.post("/api/quality-requests/:id/answer", takers, async (req, reply) => {
    await own(req);
    return reply.code(201).send(await answerQualityRequest(currentUser(req), idOf(req), (req.body as { values?: unknown } | undefined)?.values));
  });
}
