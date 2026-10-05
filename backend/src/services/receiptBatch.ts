/**
 * Opens several receipts at once from the Warehouse Incharge's batch grid.
 *
 * All-or-nothing: every row is validated first and everything is written in ONE transaction, so a
 * bad row 7 leaves no half-created batch behind — the caller fixes the row and resubmits the lot.
 * Each row goes through the same code as the one-truck wizard (nextReceiptId + applyStageFields),
 * so a batch-created receipt is indistinguishable from a hand-entered one, including the audit
 * trail (StageFieldChange, via "direct").
 */
import { Prisma } from "@prisma/client";
import {
  BATCH_MAX_ROWS, BATCH_REQUIRED_LABEL, BATCH_TRUCK_COLUMNS, type BatchTruckRow,
} from "@anagroci/contract/data/batchEntry";
import { prisma } from "../db.js";
import { ValidationError } from "../domain/validation.js";
import { applyStageFields } from "./receipts.js";
import { nextReceiptId } from "./ids.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Only the grid's own columns, trimmed and non-blank; anything else is a client bug. */
function cleanRow(raw: unknown, n: number): BatchTruckRow {
  if (!raw || typeof raw !== "object") throw new ValidationError(`Row ${n}: expected an object.`);
  const out: BatchTruckRow = {};
  for (const [stageId, fields] of Object.entries(raw as BatchTruckRow)) {
    for (const [label, value] of Object.entries(fields ?? {})) {
      if (!BATCH_TRUCK_COLUMNS.some((c) => c.stageId === stageId && c.label === label)) {
        throw new ValidationError(`Row ${n}: "${label}" isn't a batch entry column.`);
      }
      const v = String(value ?? "").trim();
      if (v) (out[stageId] ??= {})[label] = v;
    }
  }
  if (!out["n-gate"]?.[BATCH_REQUIRED_LABEL]) throw new ValidationError(`Row ${n}: ${BATCH_REQUIRED_LABEL} is required.`);
  const date = out["n-gate"]["DATE OF ARRIVAL"];
  if (date && !(ISO_DATE.test(date) && isRealDate(date))) {
    throw new ValidationError(`Row ${n}: DATE OF ARRIVAL must be a real date as YYYY-MM-DD (got "${date}").`);
  }
  return out;
}

export async function createReceiptsBatch(warehouse: string, rawRows: unknown, actorId: string): Promise<string[]> {
  if (!Array.isArray(rawRows) || rawRows.length === 0) throw new ValidationError("Add at least one truck.");
  if (rawRows.length > BATCH_MAX_ROWS) throw new ValidationError(`At most ${BATCH_MAX_ROWS} trucks per batch.`);
  const rows = rawRows.map((r, i) => cleanRow(r, i + 1));

  return prisma.$transaction(async (tx) => {
    // Receipt.warehouse is a hard FK, so name the problem rather than surface a bare P2003.
    if (!(await tx.warehouse.findUnique({ where: { name: warehouse } }))) {
      throw new ValidationError(`Unknown warehouse "${warehouse}".`);
    }
    const today = new Date().toISOString().slice(0, 10);
    const ids: string[] = [];

    for (const row of rows) {
      const gate = row["n-gate"];
      const verify = row["n-verify"];
      // Sequential within the transaction, so each call sees the receipt the previous one created.
      const arrivalDate = gate["DATE OF ARRIVAL"] ?? today;
      const id = await nextReceiptId(tx, warehouse, arrivalDate);
      await tx.receipt.create({
        data: {
          id,
          source: "entered",
          arrivalDate,
          // The receipt's own columns mirror these stage fields (see PATCHABLE in receipts.ts).
          supplierName: verify?.["SUPPLIERS NAME"] ?? "",
          lbaCode: verify?.["LBA CODE"] ?? "",
          vehicleNo: gate[BATCH_REQUIRED_LABEL],
          warehouse,
          timeline: { create: [{ status: "planned", at: new Date().toISOString(), actorId }] },
        },
      });
      const actor = { id: actorId, via: "direct" as const };
      await applyStageFields(tx, id, "n-gate", gate, { actor });
      if (verify) await applyStageFields(tx, id, "n-verify", verify, { actor });
      ids.push(id);
    }
    return ids;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
}
