import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  createTransferLot, deleteTransferLot, getTransferLot, listTransferLots, previewLotNumbers, putBackTransferLot, undoPutBack, updateTransferLot,
  weighTransferLot, type PutBackInput, type TransferLotInput, type TransferLotWeighingInput,
} from "../services/transferLots.js";
import { assertWarehouseAccess, scopedSite, scopedWarehouse } from "../auth/scope.js";
import { currentUser } from "../auth/plugin.js";
import { ValidationError } from "../domain/validation.js";

// The role travels with the actor: an Admin may correct a lot already on a truck (services/transferLots.ts), nobody else.
const actorOf = (req: FastifyRequest) => ({ actor: { id: currentUser(req).id, via: "direct" as const, role: currentUser(req).role } });

/**
 * Transfer lots (24 Nov 2026): what a Unit warehouse makes out of its Bins to send. Warehouse Incharge / admin only (the
 * narrower roles are default-deny in auth/policy.ts), and only for the caller's own warehouse.
 */
export async function transferLotRoutes(app: FastifyInstance) {
  app.get("/api/transfer-lots", async (req) => {
    const { warehouse } = req.query as { warehouse?: string };
    const names = await scopedSite(req, warehouse);
    if (!names) throw new ValidationError("Say which warehouse: ?warehouse=");
    return listTransferLots(names);
  });

  app.post("/api/transfer-lots", async (req, reply) => {
    const body = (req.body ?? {}) as TransferLotInput;
    const warehouse = scopedWarehouse(req, body.warehouse) ?? body.warehouse;
    return reply.code(201).send(await createTransferLot({ ...body, warehouse }, actorOf(req)));
  });

  /** The lot of this id, when the caller may work on it: a 404 for one that doesn't exist, a 403 for another warehouse's. */
  async function ownLot(req: FastifyRequest) {
    const id = Number((req.params as { id: string }).id);
    const lot = Number.isInteger(id) ? await getTransferLot(id) : null;
    if (!lot) throw Object.assign(new Error("Transfer lot not found"), { code: "P2025" });
    await assertWarehouseAccess(req, lot.warehouse);
    return lot;
  }

  app.patch("/api/transfer-lots/:id", async (req) => {
    const lot = await ownLot(req);
    const { warehouse: _ignored, ...body } = (req.body ?? {}) as TransferLotInput;
    return updateTransferLot(lot.id, body, actorOf(req));
  });

  app.post("/api/transfer-lots/:id/weighing", async (req) => {
    const lot = await ownLot(req);
    return weighTransferLot(lot.id, (req.body ?? {}) as TransferLotWeighingInput, actorOf(req));
  });

  // Bags of the lot not on a truck put back in a Bin of its warehouse: { binCode, bags, date? }.
  app.post("/api/transfer-lots/:id/put-back", async (req) => {
    const lot = await ownLot(req);
    return putBackTransferLot(lot.id, (req.body ?? {}) as PutBackInput, actorOf(req));
  });

  // An Admin undoes a put-back made by mistake.
  app.delete("/api/transfer-lots/:id/put-back/:returnId", async (req) => {
    const lot = await ownLot(req);
    const returnId = Number((req.params as { returnId: string }).returnId);
    if (!Number.isInteger(returnId)) throw Object.assign(new Error("Put-back not found"), { code: "P2025" });
    return undoPutBack(lot.id, returnId, actorOf(req));
  });

  app.delete("/api/transfer-lots/:id", async (req, reply) => {
    const lot = await ownLot(req);
    await deleteTransferLot(lot.id);
    return reply.code(204).send();
  });

  // The Lot numbers a form shows before saving (a lot to make, or each lot on an arriving truck). Nothing is reserved.
  app.get("/api/lot-numbers/next", async (req) => {
    const { warehouse, date, count } = req.query as { warehouse?: string; date?: string; count?: string };
    const wh = scopedWarehouse(req, warehouse) ?? warehouse;
    if (!wh) throw new ValidationError("Say which warehouse: ?warehouse=");
    return { lotNos: await previewLotNumbers(wh, date ?? "", Number(count ?? 1)) };
  });
}
