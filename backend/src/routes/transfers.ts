import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  listTransfers, getTransfer, createTransfer, addTransferLines, setTransferStatus,
  type TransferInput, type TransferLineInput,
} from "../services/transfers.js";
import { scopedSite, scopedWarehouse } from "../auth/scope.js";
import { currentUser } from "../auth/plugin.js";
import { ForbiddenError } from "../domain/validation.js";
import { resolveSite } from "../domain/site.js";

/** A Warehouse Incharge sees and acts on transfers that leave from or arrive at their own warehouse. */
async function assertTransferAccess(req: FastifyRequest, t: { fromWarehouse: string; toWarehouse: string }) {
  const user = currentUser(req);
  if (user.role === "admin") return;
  const mine = user.warehouse ? await resolveSite(user.warehouse) : [];
  if (!mine.includes(t.fromWarehouse) && !mine.includes(t.toWarehouse)) throw new ForbiddenError("That transfer isn't to or from your warehouse.");
}

const actorOf = (req: FastifyRequest) => ({ actor: { id: currentUser(req).id, via: "direct" as const } });

export async function transferRoutes(app: FastifyInstance) {
  app.get("/api/transfers", async (req) => {
    const { warehouse } = req.query as { warehouse?: string };
    return listTransfers(await scopedSite(req, warehouse));
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

  app.patch("/api/transfers/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await getTransfer(id);
    if (!t) return reply.code(404).send({ error: "Transfer not found" });
    await assertTransferAccess(req, t);
    const { status } = (req.body ?? {}) as { status?: string };
    return setTransferStatus(id, status ?? "");
  });
}
