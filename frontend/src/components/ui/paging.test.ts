/**
 * Pagination and column filters of every table (26 Nov 2026, user: "test pagination as well"). Pure logic: the page a table
 * shows, and the rows a column filter keeps — including a long checklist column such as Reception's Receipt ID.
 */
import { describe, it, expect } from "vitest";
import { pageWindow } from "./paging";
import { applyFilters, distinctValues, resolveKind, CHECKLIST_MAX, type ColumnFilter } from "./columnFilters";

describe("pageWindow", () => {
  it("shows no pager while every row fits one page", () => {
    expect(pageWindow(0, 1, 25)).toMatchObject({ page: 1, totalPages: 1, start: 0, end: 0, from: 0, to: 0, showPager: false });
    expect(pageWindow(25, 1, 25)).toMatchObject({ totalPages: 1, from: 1, to: 25, showPager: false });
  });

  it("splits 61 rows into 25 + 25 + 11", () => {
    expect(pageWindow(61, 1, 25)).toMatchObject({ page: 1, totalPages: 3, start: 0, end: 25, from: 1, to: 25, showPager: true });
    expect(pageWindow(61, 2, 25)).toMatchObject({ page: 2, start: 25, end: 50, from: 26, to: 50 });
    expect(pageWindow(61, 3, 25)).toMatchObject({ page: 3, start: 50, end: 61, from: 51, to: 61 });
  });

  it("falls back to the last page when a filter leaves fewer rows than the page asked for", () => {
    // On page 3 of 61 rows, a filter keeps 30: page 2 is the last there is.
    expect(pageWindow(30, 3, 25)).toMatchObject({ page: 2, start: 25, end: 30, from: 26, to: 30 });
    // ...and keeps none: page 1, empty.
    expect(pageWindow(0, 3, 25)).toMatchObject({ page: 1, from: 0, to: 0 });
  });

  it("never asks for page 0 or a broken page size", () => {
    expect(pageWindow(61, 0, 25).page).toBe(1);
    expect(pageWindow(61, -4, 25).page).toBe(1);
    expect(pageWindow(61, NaN, 25).page).toBe(1);
    expect(pageWindow(3, 1, 0)).toMatchObject({ totalPages: 3, end: 1 });
  });

  it("covers every row exactly once across the pages", () => {
    const total = 123;
    const { totalPages } = pageWindow(total, 1, 25);
    const seen: number[] = [];
    for (let p = 1; p <= totalPages; p++) {
      const w = pageWindow(total, p, 25);
      for (let i = w.start; i < w.end; i++) seen.push(i);
    }
    expect(seen).toEqual([...Array(total).keys()]);
  });
});

type Row = { id: string; status: string; arrived: string; bags: number | null };
const rows: Row[] = Array.from({ length: 40 }, (_, i) => ({
  id: `REC-YAK-2026-${String(i + 1).padStart(4, "0")}`,
  status: i % 3 === 0 ? "Arrived" : i % 3 === 1 ? "Unloaded" : "In stock",
  arrived: `2026-11-${String((i % 28) + 1).padStart(2, "0")}`,
  bags: i % 5 === 0 ? null : 400 + i,
}));
const idFilter: ColumnFilter<Row> = { value: (r) => r.id, kind: "select" };
const columns = [
  { label: "Receipt ID", filter: idFilter },
  { label: "Status", filter: { value: (r: Row) => r.status } },
  { label: "Arrived", filter: { value: (r: Row) => r.arrived, kind: "date" as const } },
  { label: "Bags", filter: { value: (r: Row) => r.bags, kind: "number" as const } },
];
const kinds = { "Receipt ID": "select", Status: "select", Arrived: "date", Bags: "number" } as const;

describe("column filters", () => {
  it("a column with a value per row filters when it says so (a searchable checklist), and not otherwise", () => {
    expect(rows.length).toBeGreaterThan(CHECKLIST_MAX);
    expect(resolveKind(idFilter, rows)).toBe("select");
    expect(resolveKind({ value: (r: Row) => r.id }, rows)).toBeNull();
    expect(distinctValues(idFilter, rows)).toHaveLength(40);
  });

  it("keeps the ticked values, a date range and a number range, all together", () => {
    expect(applyFilters(rows, columns, { "Receipt ID": { selected: ["REC-YAK-2026-0002", "REC-YAK-2026-0003"] } }, kinds).map((r) => r.id))
      .toEqual(["REC-YAK-2026-0002", "REC-YAK-2026-0003"]);
    expect(applyFilters(rows, columns, { Status: { selected: ["Arrived"] } }, kinds)).toHaveLength(14);
    expect(applyFilters(rows, columns, { Arrived: { from: "2026-11-01", to: "2026-11-03" } }, kinds)).toHaveLength(6);
    // A bounded number range leaves out the rows with no number at all.
    expect(applyFilters(rows, columns, { Bags: { min: "430" } }, kinds).every((r) => r.bags !== null && r.bags >= 430)).toBe(true);
    const both = applyFilters(rows, columns, { Status: { selected: ["Unloaded"] }, Bags: { max: "410" } }, kinds);
    expect(both.every((r) => r.status === "Unloaded" && r.bags! <= 410)).toBe(true);
  });

  it("then pages what is left: 14 Arrived trucks fit one page of 25, 40 trucks need two", () => {
    const arrived = applyFilters(rows, columns, { Status: { selected: ["Arrived"] } }, kinds);
    expect(pageWindow(arrived.length, 2, 25)).toMatchObject({ page: 1, showPager: false });
    expect(pageWindow(rows.length, 2, 25)).toMatchObject({ page: 2, from: 26, to: 40, showPager: true });
  });
});
