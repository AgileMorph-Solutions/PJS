/**
 * Mirrors ledgerEntries / addLedgerEntry on TrackingApi.
 *
 * Rows are normalized into four real tables (one per ledger) and re-keyed onto the workbook's own
 * column labels on the way out, via the generated LEDGER_COLUMN_MAP. Two things moved server-side
 * that the frontend used to compute in LedgerSection.tsx: the serial number and the running
 * balance — both race when two people add a row at once, and the balance now comes from a SQL
 * view that has no column to drift.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { LEDGER_COLUMN_MAP, LEDGER_IDS } from "@anagroci/contract/generated/stageFieldMap";
import type { LedgerRow } from "@anagroci/contract/types/receipt";
import { listLedgerRows, addLedgerRow } from "../services/ledgers.js";
import { reconciliation, jsonSafe } from "../domain/juteBalance.js";

function requireLedger(ledgerId: string, reply: FastifyReply): boolean {
  if (LEDGER_COLUMN_MAP[ledgerId]) return true;
  reply.code(404).send({ error: `Unknown ledger "${ledgerId}"` });
  return false;
}

export async function ledgerRoutes(app: FastifyInstance) {
  /** All four ledgers at once — matches the frontend's LedgerEntries shape. */
  app.get("/api/jute-ledgers", async () => {
    const out: Record<string, LedgerRow[]> = {};
    for (const id of LEDGER_IDS) out[id] = await listLedgerRows(id);
    return out;
  });

  app.get("/api/jute-ledgers/:ledgerId/entries", async (req, reply) => {
    const { ledgerId } = req.params as { ledgerId: string };
    if (!requireLedger(ledgerId, reply)) return;
    return listLedgerRows(ledgerId);
  });

  app.post("/api/jute-ledgers/:ledgerId/entries", async (req, reply) => {
    const { ledgerId } = req.params as { ledgerId: string };
    if (!requireLedger(ledgerId, reply)) return;
    const { row } = (req.body ?? {}) as { row?: LedgerRow };
    if (!row || typeof row !== "object") return reply.code(400).send({ error: "body.row is required" });
    const created = await addLedgerRow(ledgerId, row);
    return reply.code(201).send({ data: created, warnings: [] });
  });

  /**
   * opening + receipts + transfers in − issues − damaged/discarded − transfers out = closing,
   * per warehouse and period, computed across all four ledgers.
   */
  app.get("/api/jute-ledgers/reconciliation", async () => jsonSafe(await reconciliation()));
}
