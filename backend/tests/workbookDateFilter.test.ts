import { describe, it, expect } from "vitest";
import { exportFilename, filterByDate, isoDateOf, parseDateRange } from "../src/domain/workbook/dateFilter.js";
import { ValidationError } from "../src/domain/validation.js";

describe("parseDateRange", () => {
  it("accepts either, both or neither bound", () => {
    expect(parseDateRange()).toEqual({});
    expect(parseDateRange("2026-09-01")).toEqual({ from: "2026-09-01", to: undefined });
    expect(parseDateRange("", "2026-09-30")).toEqual({ from: undefined, to: "2026-09-30" });
    expect(parseDateRange("2026-09-30", "2026-09-30")).toEqual({ from: "2026-09-30", to: "2026-09-30" });
  });

  it("rejects a malformed or impossible date, and an inverted range", () => {
    for (const bad of ["30/09/2026", "2026-9-1", "2026-02-31", "yesterday"]) {
      expect(() => parseDateRange(bad), bad).toThrow(ValidationError);
      expect(() => parseDateRange(undefined, bad), bad).toThrow(ValidationError);
    }
    expect(() => parseDateRange("2026-09-30", "2026-09-01")).toThrow(/after/);
  });
});

describe("isoDateOf", () => {
  it("reads real dates and ISO strings, and does not guess at anything else", () => {
    expect(isoDateOf(new Date("2026-09-30T00:00:00Z"))).toBe("2026-09-30");
    expect(isoDateOf("2026-09-30")).toBe("2026-09-30");
    expect(isoDateOf("2026-09-30T10:15:00.000Z")).toBe("2026-09-30");
    // The hand-typed text the ledger imports keep verbatim (rawDate): NOT reinterpreted here.
    expect(isoDateOf("13-01-2026")).toBeNull();
    expect(isoDateOf("2026-13-45")).toBeNull();
    expect(isoDateOf("")).toBeNull();
    expect(isoDateOf(null)).toBeNull();
    expect(isoDateOf(undefined)).toBeNull();
    expect(isoDateOf(20260930)).toBeNull();
    expect(isoDateOf(new Date("nope"))).toBeNull();
  });
});

describe("filterByDate", () => {
  const rows = [
    { id: 1, d: "2026-08-31" },
    { id: 2, d: "2026-09-01" },
    { id: 3, d: new Date("2026-09-15T00:00:00Z") },
    { id: 4, d: "2026-09-30" },
    { id: 5, d: "2026-10-01" },
    { id: 6, d: null },
    { id: 7, d: "13-01-2026" },
  ];
  const ids = (r: { rows: { id: number }[] }) => r.rows.map((x) => x.id);

  it("returns everything, undated rows included, when no range is set", () => {
    const r = filterByDate(rows, "d", {});
    expect(r.rows).toHaveLength(7);
    expect(r.withoutDate).toBe(0);
  });

  it("is inclusive at both ends", () => {
    expect(ids(filterByDate(rows, "d", { from: "2026-09-01", to: "2026-09-30" }))).toEqual([2, 3, 4]);
    expect(ids(filterByDate(rows, "d", { from: "2026-09-15", to: "2026-09-15" }))).toEqual([3]);
  });

  it("supports an open end", () => {
    expect(ids(filterByDate(rows, "d", { from: "2026-09-30" }))).toEqual([4, 5]);
    expect(ids(filterByDate(rows, "d", { to: "2026-09-01" }))).toEqual([1, 2]);
  });

  it("leaves out rows with no usable date under a range, and counts them instead of hiding them", () => {
    const r = filterByDate(rows, "d", { from: "2000-01-01" });
    expect(ids(r)).toEqual([1, 2, 3, 4, 5]);
    expect(r.withoutDate).toBe(2); // the null and the hand-typed "13-01-2026"
  });
});

describe("exportFilename", () => {
  it("uses today's date without a range, and the range with one", () => {
    expect(exportFilename("Receipts", {}, "2026-09-30")).toBe("Receipts 2026-09-30.xlsx");
    expect(exportFilename("Receipts", { from: "2026-09-01", to: "2026-09-30" }, "2026-09-30")).toBe("Receipts 2026-09-01 to 2026-09-30.xlsx");
    expect(exportFilename("Receipts", { from: "2026-09-01" }, "x")).toBe("Receipts 2026-09-01 to end.xlsx");
    expect(exportFilename("Receipts", { to: "2026-09-30" }, "x")).toBe("Receipts start to 2026-09-30.xlsx");
  });
});
