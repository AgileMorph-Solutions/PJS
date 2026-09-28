/**
 * The jute ledger's arithmetic, against the real 298- and 367-row imports.
 *
 * The headline assertion is balance_delta = 0 on every row: the workbook's own BALANCE column
 * agrees exactly with the running sum computed by the view. That proves the import was faithful,
 * and it stays as a permanent regression guard — any future row that doesn't follow lights up.
 */
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { warehouseBalanceRows, balanceDriftRows, negativeBalanceRows, transferFlagRows, reconciliation } from "../src/domain/juteBalance.js";
import { checkReconciliation } from "@anagroci/contract/domain/jute";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

describe("ledger 1 — warehouse stock", () => {
  it("imported all 298 rows", async () => {
    expect((await warehouseBalanceRows()).length).toBe(298);
  });

  it("the workbook's reported balance matches the computed running balance on every row", async () => {
    expect(await balanceDriftRows()).toEqual([]);
  });

  it("ends at the real final balance of -11,027", async () => {
    const rows = await warehouseBalanceRows();
    expect(Number(rows[rows.length - 1].computed_balance)).toBe(-11027);
  });

  it("preserves the 35 genuinely negative rows rather than correcting them", async () => {
    // A real data-quality signal (issues exceed recorded receipts), not a formula bug — the
    // arithmetic is internally consistent. Surfaced, never clamped to zero.
    expect((await negativeBalanceRows()).length).toBe(35);
  });
});

describe("ledger 4 — warehouse-to-warehouse transfers", () => {
  it("imported all 415 rows", async () => {
    // Re-measured after switching ledger 4's source to Bouake RCN Receiving at Factory
    // Report.xlsx -> Bouake Stock Reciving (415 real rows) — a newer, larger snapshot of the
    // same shape the old 367-row file had.
    expect((await transferFlagRows()).length).toBe(415);
  });

  it("flags the degenerate DIFF column on all 415 rows without dropping or regenerating it", async () => {
    const rows = await transferFlagRows();
    expect(rows.filter((r) => r.diff_is_degenerate).length).toBe(415);
    // The real Difference column is a different thing and stays meaningful.
    expect(rows.filter((r) => r.difference_mismatch).length).toBe(0);
  });

  it("keeps the raw text of comma-decimal cells alongside the parsed number", async () => {
    const withRaw = await prisma.juteWarehouseTransferReceipt.findMany({
      where: { korReceivedRaw: { not: null } }, select: { korReceivedRaw: true },
    });
    expect(withRaw.length).toBeGreaterThan(0);
    expect(withRaw.some((r) => r.korReceivedRaw!.includes(","))).toBe(true);
  });
});

describe("reconciliation", () => {
  it("computes the rule across all four ledgers, per warehouse and period", async () => {
    const rows = await reconciliation();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const got = checkReconciliation({
        opening: Number(r.opening ?? 0), receipts: Number(r.receipts ?? 0),
        transfersIn: Number(r.transfers_in ?? 0), issues: Number(r.issues ?? 0),
        damagedOrDiscarded: Number(r.damaged_or_discarded ?? 0),
        transfersOut: Number(r.transfers_out ?? 0),
        closing: Number(r.expected_closing ?? 0),
      });
      // expected_closing is the rule applied to that row's own totals, so it must balance.
      expect(got.balanced).toBe(true);
    }
  });

  it("ledgers 2 and 3 hold no invented rows, only the real undated tally", async () => {
    expect(await prisma.juteSupplierMovement.count()).toBe(0);
    expect(await prisma.juteProductionMovement.count()).toBe(0);
    expect(await prisma.juteTallySnapshot.count()).toBe(10);
  });
});
