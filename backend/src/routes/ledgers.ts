// Mirrors ledgerEntries / addLedgerEntry on TrackingApi. Ledger *definitions* (columns, which
// are real vs. new, sample rows, data-quality flags) are static content owned by
// frontend/src/data/juteBags.ts — same relationship as stages.ts to the receipt routes — so this
// only persists the dynamic part: rows a user actually adds via "+ Add entry".
//
// Known simplification (documented, not hidden): this endpoint doesn't hardcode per-ledger
// column knowledge (that would duplicate juteBags.ts and risk drifting from it). Instead the
// caller states which of the columns it's submitting are derived, and the server computes them —
// see withDerivedColumns. Today only the warehouse-stock ledger's "S N"/"Balance" columns are
// derived (frontend/src/components/LedgerSection.tsx's DERIVED_COLUMNS).
import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { withDerivedColumns } from "../domain/jute.js";
import { JUTE_LEDGER_IDS, type LedgerRow } from "../types.js";

export async function ledgerRoutes(app: FastifyInstance) {
  app.get("/api/jute-ledgers/:ledgerId/entries", async (req, reply) => {
    const { ledgerId } = req.params as { ledgerId: string };
    if (!JUTE_LEDGER_IDS.includes(ledgerId as (typeof JUTE_LEDGER_IDS)[number])) {
      return reply.code(404).send({ error: `Unknown ledger "${ledgerId}"` });
    }
    const rows = await prisma.juteLedgerEntry.findMany({ where: { ledgerId }, orderBy: { id: "asc" } });
    return rows.map((r) => JSON.parse(r.row) as LedgerRow);
  });

  app.post("/api/jute-ledgers/:ledgerId/entries", async (req, reply) => {
    const { ledgerId } = req.params as { ledgerId: string };
    if (!JUTE_LEDGER_IDS.includes(ledgerId as (typeof JUTE_LEDGER_IDS)[number])) {
      return reply.code(404).send({ error: `Unknown ledger "${ledgerId}"` });
    }
    const { row, derivedColumns } = req.body as { row: LedgerRow; derivedColumns?: string[] };

    const existingRaw = await prisma.juteLedgerEntry.findMany({ where: { ledgerId }, orderBy: { id: "asc" } });
    const existingRows = existingRaw.map((r) => JSON.parse(r.row) as LedgerRow);

    const finalRow = withDerivedColumns(row, existingRows, derivedColumns ?? []);
    await prisma.juteLedgerEntry.create({ data: { ledgerId, row: JSON.stringify(finalRow) } });

    return finalRow;
  });
}
