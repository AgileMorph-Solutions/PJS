import { JUTE_OPENING_ACTIVITY } from "@anagroci/contract/domain/juteOpeningBalance";

/** A Warehouse Stock ledger row as the API sends it: every value a string, keyed by the column labels in juteBags.ts. */
export type StockRow = Record<string, string>;

/** A bag count, or null when the cell is blank. The server sends plain integers ("6000"); no thousands separators. */
export function bagCount(v: string | undefined): number | null {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const formatBags = (n: number) => n.toLocaleString();

export const isOpeningRow = (row: StockRow) => (row["Activities type"] ?? "").trim().toUpperCase() === JUTE_OPENING_ACTIVITY;

/**
 * The balance each row started from: the row above it in the same warehouse, or 0 for a warehouse's first row. Read from
 * every row, not the page or date range shown, so a filtered view still explains each balance correctly. The balances
 * themselves are the server's (a SQL running sum); this only points at the one above.
 */
export function previousBalances(rows: StockRow[]): Map<StockRow, number> {
  const last = new Map<string, number>();
  const out = new Map<StockRow, number>();
  for (const row of rows) {
    const wh = row["WH location"] ?? "";
    out.set(row, last.get(wh) ?? 0);
    const b = bagCount(row["Balance"]);
    if (b !== null) last.set(wh, b);
  }
  return out;
}
