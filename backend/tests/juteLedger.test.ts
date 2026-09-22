import { describe, it, expect } from "vitest";
import { lastBalance, withDerivedColumns, checkReconciliation } from "@anagroci/contract/domain/jute";
import type { LedgerRow } from "@anagroci/contract/types/receipt";

// Real fixture — the exact 3 sample rows from frontend/src/data/juteBags.ts's "warehouse-stock"
// ledger, read directly from BOUAKE WAREHOUSE JUTE BAGS MOVEMENT REPORT.xlsx with openpyxl.
const REAL_WAREHOUSE_STOCK_ROWS: LedgerRow[] = [
  {
    "S N": "1",
    Date: "2026-01-13",
    "Activities type": "JUTE BAGS PURCHASED/UNLOADINGS",
    "WH location": "BOUAKE",
    "Truck number": "7270HL01",
    "W/R No.": "453",
    "Bags received": "30000",
    Balance: "30000",
  },
  {
    "S N": "12",
    Date: "2026-02-11",
    "Activities type": "CAPCD SCOOPS",
    "Supplier code": "LBA-010-CAP",
    "WH location": "BOUAKE",
    "Truck number": "5978-GX-01",
    "Bags issued": "3000",
    Balance: "329000",
  },
  {
    "S N": "37",
    Date: "2026-02-24",
    "Activities type": "TRANSFFER TO YAMOUSSOUKRO",
    "WH location": "BOUAKE",
    "Truck number": "558-PQ-01",
    "W/R No.": "544",
    "Bags issued": "26625",
    Balance: "240906",
  },
];

describe("lastBalance", () => {
  it("reads the Balance off the real last row", () => {
    expect(lastBalance(REAL_WAREHOUSE_STOCK_ROWS)).toBe(240906);
  });

  it("is 0 for an empty ledger", () => {
    expect(lastBalance([])).toBe(0);
  });
});

describe("withDerivedColumns", () => {
  it("computes Balance = last balance + received - issued, and auto-increments S N", () => {
    const newRow: LedgerRow = { Date: "2026-02-25", "Activities type": "REBAGGING DURING UNLOADING", "Bags received": "500" };
    const out = withDerivedColumns(newRow, REAL_WAREHOUSE_STOCK_ROWS, ["S N", "Balance"]);
    expect(out.Balance).toBe(String(240906 + 500));
    expect(out["S N"]).toBe(String(REAL_WAREHOUSE_STOCK_ROWS.length + 1));
  });

  it("leaves non-derived columns alone when no derivedColumns are requested", () => {
    const newRow: LedgerRow = { Date: "2026-02-25", "Bags issued": "10" };
    const out = withDerivedColumns(newRow, REAL_WAREHOUSE_STOCK_ROWS, []);
    expect(out).toEqual(newRow);
  });
});

describe("checkReconciliation", () => {
  // The Sept 2026 clarification's formula, also quoted verbatim in
  // frontend/src/data/juteBags.ts's juteReconciliationRule export.
  it("balances a clean warehouse-level movement", () => {
    const result = checkReconciliation({
      opening: 1000,
      receipts: 500,
      transfersIn: 0,
      issues: 300,
      damagedOrDiscarded: 50,
      transfersOut: 100,
      closing: 1050,
    });
    expect(result).toEqual({ balanced: true, expectedClosing: 1050, delta: 0 });
  });

  it("flags a mismatch when the recorded closing figure doesn't match the formula", () => {
    const result = checkReconciliation({
      opening: 1000,
      receipts: 0,
      transfersIn: 0,
      issues: 300,
      damagedOrDiscarded: 0,
      transfersOut: 0,
      closing: 750, // should be 700 — someone's off by 50 somewhere
    });
    expect(result.balanced).toBe(false);
    expect(result.expectedClosing).toBe(700);
    expect(result.delta).toBe(50);
  });

  it("does not block a mathematically-consistent negative balance", () => {
    // Deliberate: the real warehouse-stock sheet's own running Balance genuinely goes negative
    // from row 195 on (flagged in frontend/src/data/juteBags.ts) — an operationally alarming but
    // mathematically consistent figure. checkReconciliation reports the math; it's the caller's
    // job to decide whether a negative closing balance itself is worth a separate warning.
    const result = checkReconciliation({
      opening: 100,
      receipts: 0,
      transfersIn: 0,
      issues: 500,
      damagedOrDiscarded: 0,
      transfersOut: 0,
      closing: -400,
    });
    expect(result.balanced).toBe(true);
    expect(result.expectedClosing).toBe(-400);
  });
});
