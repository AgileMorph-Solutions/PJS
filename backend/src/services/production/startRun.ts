/**
 * Start a production run in one go: the warehouse bins going to the floor, and — optionally — the loads (RCN receipts)
 * already brought from them, each with its date, BTM slip number and bin. One transaction: if any load is wrong, the
 * run isn't created either, so there is never a run with only some of its loads. Each load goes through exactly the
 * rules of "Record a load" (createRcnReceiptIn), and the run through those of a plain start (createBatchIn).
 */
import type { RcnReceiptInput } from "@anagroci/contract/types/rcnReceipt";
import { prisma } from "../../db.js";
import { ValidationError } from "../../domain/validation.js";
import { createBatchIn, procurementBinStock, type CreateBatchInput } from "./batches.js";
import { createRcnReceiptIn } from "./rcnReceipts.js";

export interface StartRunInput extends CreateBatchInput {
  /** Rows left completely blank are ignored; any other row must be a whole load. */
  loads?: Omit<RcnReceiptInput, "batchCode">[];
}

const blank = (l: Omit<RcnReceiptInput, "batchCode">) => ![l.date, l.btmNo, l.binCode].some((v) => (v ?? "").trim());

export async function startRun(site: string, actorId: string, input: StartRunInput): Promise<string> {
  const stock = await procurementBinStock(site);
  const loads = (input.loads ?? []).filter((l) => !blank(l));
  return prisma.$transaction(async (tx) => {
    const code = await createBatchIn(tx, site, actorId, input, stock);
    for (const [i, load] of loads.entries()) {
      try {
        await createRcnReceiptIn(tx, site, actorId, { ...load, batchCode: code });
      } catch (e) {
        // Name the row, so the screen can say which load to fix; the whole start is rolled back.
        if (e instanceof ValidationError) throw new ValidationError(`Load ${i + 1}: ${e.message}`);
        throw e;
      }
    }
    return code;
  });
}
