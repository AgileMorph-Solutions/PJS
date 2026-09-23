import { describe, it, expect, afterAll, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { lastBalance, withDerivedColumns, checkReconciliation } from "@anagroci/contract/domain/jute";
import type { LedgerRow } from "@anagroci/contract/types/receipt";
import { addLedgerRow } from "../src/services/ledgers.js";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

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

// Ledgers 2 and 3 had zero write-path coverage before this: `supplierCode` is NOT NULL on
// JuteSupplierMovement but had no column in juteBags.ts, so `addLedgerRow` would have thrown on
// every real submission. These prove the newly-wired traceability fields (Sept 2026 clarification:
// Warehouse -> Supplier/Department -> Activity -> Quantity -> Movement Type -> Responsible
// Person/Team -> Date) round-trip, and that a blank required field no longer crashes the write.
describe("addLedgerRow — supplier-movement and factory-production-tracking", () => {
  const TEST_SUPPLIER = "TEST-SENTINEL-SUPPLIER";
  const TEST_DEPT = "TEST-SENTINEL-DEPT";

  // Cleaned up after EVERY test, not batched to afterAll: dataQuality.test.ts's
  // "ledger_has_no_row_level_source" check asserts these two tables are always empty, and that
  // check can run concurrently (a separate test file, same live database) — keeping the window
  // where a sentinel row exists to a single test avoids a spurious cross-file failure there.
  afterEach(async () => {
    await prisma.juteSupplierMovement.deleteMany({ where: { supplierCode: { startsWith: "TEST-SENTINEL" } } });
    await prisma.juteProductionMovement.deleteMany({ where: { department: TEST_DEPT } });
  });

  it("writes and reads back Date/Warehouse/Activity/Movement Type/Responsible Person on supplier-movement", async () => {
    const row = await addLedgerRow("supplier-movement", {
      "Supplier code": TEST_SUPPLIER,
      Date: "2026-04-01",
      Warehouse: "BOUAKE",
      Activity: "Issued in advance",
      "Bags issued to supplier": "500",
      "Movement Type": "Issue",
      "Responsible Person/Team": "J. Kouassi",
    });
    expect(row["Supplier code"]).toBe(TEST_SUPPLIER);
    expect(row.Date).toBe("2026-04-01");
    expect(row.Warehouse).toBe("BOUAKE");
    expect(row.Activity).toBe("Issued in advance");
    expect(row["Bags issued to supplier"]).toBe("500");
    expect(row["Movement Type"]).toBe("Issue");
    expect(row["Responsible Person/Team"]).toBe("J. Kouassi");
  });

  it("does not crash when Supplier code is left blank (supplierCode is NOT NULL)", async () => {
    const row = await addLedgerRow("supplier-movement", { "Supplier code": TEST_SUPPLIER, "Bags issued to supplier": "10" });
    expect(row["Supplier code"]).toBe(TEST_SUPPLIER);
  });

  it("writes and reads back Date/Warehouse/Department/Responsible Person on factory-production-tracking", async () => {
    const row = await addLedgerRow("factory-production-tracking", {
      Date: "2026-04-02",
      Warehouse: "BOUAKE",
      Department: TEST_DEPT,
      Activity: "Issued to Production",
      "Issued to Production": "200",
      "Movement Type": "Issue",
      "Responsible Person/Team": "M. Diallo",
    });
    expect(row.Date).toBe("2026-04-02");
    expect(row.Department).toBe(TEST_DEPT);
    expect(row["Issued to Production"]).toBe("200");
    expect(row["Responsible Person/Team"]).toBe("M. Diallo");
  });

  it("drops an unparseable date rather than sending an invalid string to a DateTime column", async () => {
    const row = await addLedgerRow("supplier-movement", { "Supplier code": TEST_SUPPLIER, Date: "not-a-date" });
    expect(row.Date).toBe("");
  });
});
