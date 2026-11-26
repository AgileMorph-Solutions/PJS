/**
 * A truck from the Unit warehouse arrives at the Central one (24 Nov 2026). It is received exactly like a supplier truck —
 * the same reception record and steps (services/receipts.ts) — one record per lot on it, as the user decided: a truck with
 * two lots is two receptions. Each record links to its BKT line (Receipt.transferLineId), which is how it knows what was sent
 * and that it has no supplier or price (contract domain/transferReception.ts).
 *
 * Starting the reception creates those records with what the truck already says: the day it arrived and its number. The
 * gate step's own automatic fields (the warehouse) fill as they do for any truck. Everything else is entered step by step.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { ValidationError } from "../domain/validation.js";
import { nextReceiptId } from "./ids.js";
import { applyStageFields, type WriteOpts } from "./receipts.js";

/**
 * Start receiving a dispatched BKT: one reception per lot on it, in the order they were loaded. Calling it again creates
 * only what is missing and returns all of them, so a second click can't make a truck's lots twice.
 */
export async function startTransferReceptions(transferId: string, opts: WriteOpts = {}): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    const t = await tx.transferRequest.findUnique({
      where: { id: transferId },
      include: { lines: { orderBy: { id: "asc" }, select: { id: true, reception: { select: { id: true } } } } },
    });
    if (!t) throw Object.assign(new Error("Transfer not found"), { code: "P2025" });
    if (t.status === "requested") throw new ValidationError(`${transferId} hasn't been dispatched yet — there is no truck to receive.`);
    // Received before receptions existed (the whole-truck arrival on the BKT): it has its arrival already.
    if (t.status === "received" && t.lines.every((l) => !l.reception)) throw new ValidationError(`${transferId} was already received.`);
    if (!t.lines.length) throw new ValidationError(`${transferId} has nothing on it to receive.`);

    const date = new Date().toISOString().slice(0, 10);
    // Received at the store the truck was sent to, when one was chosen; otherwise at the site.
    const warehouse = t.toStore ?? t.toWarehouse;
    const ids: string[] = [];
    for (const line of t.lines) {
      if (line.reception) { ids.push(line.reception.id); continue; }
      const id = await nextReceiptId(tx, warehouse, date);
      await tx.receipt.create({
        data: {
          id, source: "entered", arrivalDate: date, supplierName: "", lbaCode: "", vehicleNo: t.truckNo ?? "", warehouse,
          transferLineId: line.id,
          timeline: { create: [{ status: "planned", at: new Date().toISOString(), actorId: opts.actor?.id, note: `Arrived from ${t.fromWarehouse} on ${transferId}` }] },
        },
      });
      await applyStageFields(tx, id, "n-gate", { "DATE OF ARRIVAL": date, ...(t.truckNo ? { "VEHICLE NO.": t.truckNo } : {}) }, opts);
      ids.push(id);
    }
    return ids;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
