import { describe, it, expect } from "vitest";
import { DERIVED_COLUMNS, SUPPLIER_PENDING_COLUMN, supplierPendingBalances, supplierPendingPreview } from "../src/domain/jute.js";

const row = (supplierCode: string, issued: number | null, returned: number | null) => ({ supplierCode, issued, returned });

describe("supplierPendingBalances", () => {
  it("runs across a supplier's rows", () => {
    expect(supplierPendingBalances([row("A", 1000, null), row("A", null, 800), row("A", 50, 25)])).toEqual([1000, 200, 225]);
  });

  it("keeps each supplier's balance separate", () => {
    expect(supplierPendingBalances([row("A", 1000, null), row("B", 300, null), row("A", null, 400), row("B", null, 100)])).toEqual([1000, 300, 600, 200]);
  });

  it("goes negative when more came back than was issued, rather than stopping at zero", () => {
    expect(supplierPendingBalances([row("A", 1000, null), row("A", null, 1100)])).toEqual([1000, -100]);
  });

  it("gives a row with no supplier no balance, and doesn't let it touch anyone else's", () => {
    expect(supplierPendingBalances([row("A", 10, null), row(" ", 500, null), row("A", 10, null)])).toEqual([10, null, 20]);
  });

  it("treats the column as calculated, so no form offers it for typing", () => {
    expect(DERIVED_COLUMNS.has(SUPPLIER_PENDING_COLUMN)).toBe(true);
  });
});

describe("supplierPendingPreview", () => {
  const rows = [
    { "Supplier code": "A", [SUPPLIER_PENDING_COLUMN]: "1000" },
    { "Supplier code": "B", [SUPPLIER_PENDING_COLUMN]: "7" },
    { "Supplier code": "A", [SUPPLIER_PENDING_COLUMN]: "200" },
  ];

  it("continues from the supplier's latest balance", () => {
    expect(supplierPendingPreview(rows, { "Supplier code": "A", "Returned through RCN deliveries": "300" })).toBe("-100");
    expect(supplierPendingPreview(rows, { "Supplier code": "B", "Bags issued to supplier": "3" })).toBe("10");
  });

  it("starts a new supplier from zero", () => {
    expect(supplierPendingPreview(rows, { "Supplier code": "C", "Bags issued to supplier": "5" })).toBe("5");
  });

  it("shows nothing without a supplier, or while a count isn't a number", () => {
    expect(supplierPendingPreview(rows, { "Supplier code": " ", "Bags issued to supplier": "5" })).toBe("");
    expect(supplierPendingPreview(rows, { "Supplier code": "A", "Bags issued to supplier": "abc" })).toBe("");
  });
});
