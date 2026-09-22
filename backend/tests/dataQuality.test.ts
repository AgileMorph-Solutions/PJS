/**
 * The data-quality audit, asserted against the measured reality of the client's workbooks.
 *
 * These counts are not arbitrary: each was measured from the source data. If one changes, either
 * the data changed or something started silently "cleaning" it — both worth failing over.
 */
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { scanAll } from "../src/domain/dataQuality/index.js";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

describe("data-quality audit", () => {
  it("reports the known findings with their measured counts", async () => {
    const { checks } = await scanAll();
    const by = Object.fromEntries(checks.map((c) => [c.id, c]));

    // 6 receipts arrive already rejected with no reason in the source sheet.
    expect(by["rejected_without_reason"]?.affectedCount).toBe(6);
    // The DIFF column is degenerate on every one of ledger 4's rows.
    expect(by["ledger4_diff_degenerate"]?.affectedCount).toBe(367);
    // The negative running balance is real and preserved.
    expect(by["jute_balance_negative"]?.affectedCount).toBe(35);
    // Ledger 1 records 3 transfers out against ledger 4's 367 inbound.
    expect(by["transfer_out_undercounted"]).toBeTruthy();
    // 7 transfer origins are absent from the origins master.
    expect(by["origin_not_in_master"]?.affectedCount).toBe(7);
    // Ledgers 2 and 3 have no row-level source at all.
    expect(by["ledger_has_no_row_level_source"]?.affectedCount).toBe(2);
    // The ANAGROCI-01 -> Yakro mapping is inferred, not stated.
    expect(by["warehouse_alias_inferred"]?.affectedCount).toBe(1);

    // The import-fidelity guard: the workbook's balance never disagrees with its own arithmetic.
    expect(by["jute_balance_drift"]).toBeUndefined();
  });

  it("findings are aggregate, never one per row", async () => {
    const { checks } = await scanAll();
    for (const c of checks) expect(c.sampleIds.length).toBeLessThanOrEqual(5);
  });

  it("sorts the most serious findings first", async () => {
    const { checks } = await scanAll();
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    const seq = checks.map((c) => rank[c.severity]);
    expect(seq).toEqual([...seq].sort((a, b) => a - b));
  });
});
