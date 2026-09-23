/**
 * Status parity: the normalization must not change any receipt's derived status.
 *
 * deriveStatus() keys off the PRESENCE of a stage, so this is the test that would catch an
 * "optimisation" like skipping all-blank stage rows on import, or auto-creating a system stage —
 * either of which silently reclassifies real trucks. (Auto-creating n-stock whenever n-grn exists,
 * for instance, moves four seeded receipts from grn_completed to in_stock.)
 */
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { deriveStatus, computeDashboardCounts } from "@anagroci/contract/domain/receiptStatus";
import { RECEIPT_INCLUDE, assembleStageData, assembleBranches } from "../src/stageStore.js";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

// Scopes every query below to the original 50-receipt demo seed — stageDataShadow is set only by
// prisma/seed.ts, never by the interactive create-receipt path or the excel-importer's
// commitReceipts(), so this stays exactly the golden cohort no matter how much real data is
// imported later (see backend/tests/roundTrip.test.ts's beforeAll for the same reasoning).
const SEED_ONLY = { stageDataShadow: { not: null } } as const;

describe("status parity with the pre-normalization data", () => {
  it("every receipt derives the same status from the tables as from the original JSON", async () => {
    const rows = await prisma.receipt.findMany({ where: SEED_ONLY, include: RECEIPT_INCLUDE });
    const drift: string[] = [];
    for (const row of rows) {
      const before = deriveStatus({
        stageData: JSON.parse(row.stageDataShadow!),
        branches: assembleBranches(row),
      });
      const after = deriveStatus({ stageData: assembleStageData(row), branches: assembleBranches(row) });
      if (before !== after) drift.push(`${row.id}: ${before} -> ${after}`);
    }
    expect(drift).toEqual([]);
  });

  it("the dashboard counts are unchanged, and match what doc §3 asks for", async () => {
    const rows = await prisma.receipt.findMany({ where: SEED_ONLY, include: RECEIPT_INCLUDE });
    const after = computeDashboardCounts(
      rows.map((r) => ({ stageData: assembleStageData(r), branches: assembleBranches(r) }))
    );
    const before = computeDashboardCounts(
      rows.map((r) => ({ stageData: JSON.parse(r.stageDataShadow!), branches: assembleBranches(r) }))
    );
    expect(after).toEqual(before);
    // The six figures doc §3 asks the dashboard to answer for any period.
    expect(after).toEqual({
      totalReceived: 50, acceptedUnloaded: 35, grnCompleted: 27,
      pendingQa: 5, pendingUnload: 4, rejected: 6,
    });
  });

  it("n-stock is never auto-created — that alone would move four receipts", async () => {
    const withGrn = await prisma.stageEntry.findMany({
      where: { stageId: "n-grn", receipt: SEED_ONLY }, select: { receiptId: true },
    });
    const withStock = new Set(
      (await prisma.stageEntry.findMany({
        where: { stageId: "n-stock", receipt: SEED_ONLY }, select: { receiptId: true },
      })).map((e) => e.receiptId)
    );
    // Four receipts have a GRN but no stock posting. They must stay grn_completed.
    const grnOnly = withGrn.filter((e) => !withStock.has(e.receiptId));
    expect(grnOnly.length).toBe(4);
  });
});
