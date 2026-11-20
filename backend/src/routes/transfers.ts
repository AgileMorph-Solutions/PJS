import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  listTransfers, listTransferDestinations, getTransfer, createTransfer, addTransferLines, dispatchTransfer, receiveTransfer,
  TruckOnTheRoadError, transferSites, truckOnTheRoadMessage,
  type TransferInput, type TransferLineInput, type DispatchInput, type ReceiveInput,
} from "../services/transfers.js";
import type { TruckOnTheRoadDetail } from "@anagroci/contract/domain/transfers";
import { assertWarehouseAccess, scopedSite, scopedWarehouse } from "../auth/scope.js";
import { currentUser } from "../auth/plugin.js";
import { ForbiddenError, ValidationError } from "../domain/validation.js";
import { resolveScope } from "../domain/site.js";

type TransferEnds = { fromWarehouse: string; toWarehouse: string; toStore?: string | null };

/** A Warehouse Incharge sees transfers that leave from or arrive at their own warehouse. */
async function canSeeTransfer(req: FastifyRequest, t: TransferEnds): Promise<boolean> {
  const user = currentUser(req);
  if (user.role === "admin") return true;
  const mine = user.warehouse ? await resolveScope(user.warehouse) : [];
  return mine.includes(t.fromWarehouse) || mine.includes(t.toStore ?? t.toWarehouse);
}

async function assertTransferAccess(req: FastifyRequest, t: TransferEnds) {
  if (!(await canSeeTransfer(req, t))) throw new ForbiddenError("That transfer isn't to or from your warehouse.");
}

const actorOf = (req: FastifyRequest) => ({ actor: { id: currentUser(req).id, via: "direct" as const } });

export async function transferRoutes(app: FastifyInstance) {
  app.get("/api/transfers", async (req) => {
    const { warehouse } = req.query as { warehouse?: string };
    return listTransfers(await scopedSite(req, warehouse));
  });

  // Where the caller's warehouse can send a BKT. A Warehouse Incharge asks for their own; an admin names it.
  app.get("/api/transfers/destinations", async (req) => {
    const { from } = req.query as { from?: string };
    return listTransferDestinations(scopedWarehouse(req, from) ?? from);
  });

  app.get("/api/transfers/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await getTransfer(id);
    if (!t) return reply.code(404).send({ error: "Transfer not found" });
    await assertTransferAccess(req, t);
    return t;
  });

  // A Warehouse Incharge sends from their own warehouse; an admin names the sender.
  app.post("/api/transfers", async (req, reply) => {
    const body = (req.body ?? {}) as TransferInput;
    const fromWarehouse = scopedWarehouse(req, body.fromWarehouse) ?? body.fromWarehouse;
    return reply.code(201).send(await createTransfer({ ...body, fromWarehouse }, actorOf(req)));
  });

  app.post("/api/transfers/:id/lines", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await getTransfer(id);
    if (!t) return reply.code(404).send({ error: "Transfer not found" });
    // Only the sending side adds Lots.
    if (currentUser(req).role !== "admin") scopedWarehouse(req, t.fromWarehouse);
    const { lines } = (req.body ?? {}) as { lines?: TransferLineInput[] };
    return addTransferLines(id, lines ?? [], actorOf(req));
  });

  // The two halves of a BKT, each written only by its own warehouse. The sending side says what left;
  // the destination says what arrived — neither can fill in the other's.
  app.post("/api/transfers/:id/dispatch", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await getTransfer(id);
    if (!t) return reply.code(404).send({ error: "Transfer not found" });
    if (currentUser(req).role !== "admin") scopedWarehouse(req, t.fromWarehouse);
    try {
      return await dispatchTransfer(id, (req.body ?? {}) as DispatchInput, actorOf(req));
    } catch (err) {
      if (!(err instanceof TruckOnTheRoadError)) throw err;
      // Name and link the BKT the truck is still on only for someone who may open it; anyone else is told it is
      // another warehouse's, never its number.
      if (!(await canSeeTransfer(req, err.clash))) throw new ValidationError(truckOnTheRoadMessage(err.truckNo));
      const detail: TruckOnTheRoadDetail = { kind: "truck_on_the_road", transferId: err.clash.id, sites: await transferSites(err.clash) };
      throw new ValidationError(err.message, detail);
    }
  });

  app.post("/api/transfers/:id/receive", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await getTransfer(id);
    if (!t) return reply.code(404).send({ error: "Transfer not found" });
    // Sent to one store: only that store (or an account over its whole site) receives it, never a sibling store.
    await assertWarehouseAccess(req, t.toStore ?? t.toWarehouse);
    return receiveTransfer(id, (req.body ?? {}) as ReceiveInput, actorOf(req));
  });
}
