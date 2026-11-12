import { formatDate } from "@anagroci/contract/domain/dateFormat";
import { bagCount, formatBags, isOpeningRow, previousBalances, type StockRow } from "./stockRows";

/** The reference columns, shown under the entry instead of as five mostly-empty columns. */
const DETAILS: [column: string, label: string][] = [
  ["Supplier code", "Supplier"],
  ["Truck number", "Truck"],
  ["W/R No.", "W/R"],
  ["Good bags available", "Good bags"],
  ["Completely damaged/discarded", "Damaged"],
  ["Damaged/repairable", "Repairable"],
];

const th = "px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-warmstone-500 whitespace-nowrap";

interface Props {
  /** The rows on this page of the table. */
  rows: StockRow[];
  /** Every row, so each balance can name the one before it even when that row is filtered out or on another page. */
  allRows: StockRow[];
  /** Shown instead of rows when there are none. */
  emptyText: string | null;
  /** True when several warehouses are listed together, so each row names its own. */
  showWarehouse: boolean;
}

/**
 * The Warehouse Stock ledger as a register a storekeeper can read: bags in and out as signed figures, and each balance with
 * the sum that made it ("8,000 − 1,000"). The ledger's other columns are still there, under the entry they belong to.
 */
export function StockRegisterTable({ rows, allRows, emptyText, showWarehouse }: Props) {
  const previous = previousBalances(allRows);
  return (
    <table className="w-full text-[13px] border-collapse">
      <thead>
        <tr className="border-b border-warmstone-200 bg-warmstone-50">
          <th className={`${th} text-left`}>Date</th>
          <th className={`${th} text-left`}>Entry</th>
          <th className={`${th} text-right`}>Bags in</th>
          <th className={`${th} text-right`}>Bags out</th>
          <th className={`${th} text-right`}>Balance</th>
        </tr>
      </thead>
      <tbody>
        {emptyText && (
          <tr>
            <td colSpan={5} className="px-3 py-4 text-warmstone-500">{emptyText}</td>
          </tr>
        )}
        {rows.map((row, i) => {
          const opening = isOpeningRow(row);
          const bagsIn = bagCount(row["Bags received"]);
          const bagsOut = bagCount(row["Bags issued"]);
          const balance = bagCount(row["Balance"]);
          const before = previous.get(row) ?? 0;
          const details = [
            row["S N"] ? `No. ${row["S N"]}` : "",
            showWarehouse ? row["WH location"] ?? "" : "",
            ...DETAILS.map(([col, label]) => (row[col]?.trim() ? `${label} ${row[col]}` : "")),
          ].filter(Boolean);
          return (
            <tr key={i} className={`border-b border-warmstone-100 last:border-0 ${opening ? "bg-brand-50/50" : "hover:bg-warmstone-50"}`}>
              <td className="px-3 py-2.5 text-warmstone-800 whitespace-nowrap align-top">{formatDate(row["Date"]) || "-"}</td>
              <td className="px-3 py-2.5 align-top">
                <div className={opening ? "font-bold text-warmstone-900" : "text-warmstone-800"}>
                  {opening ? "Opening stock" : row["Activities type"] || "-"}
                </div>
                {details.length > 0 && <div className="mt-0.5 text-[11px] text-warmstone-500">{details.join(" · ")}</div>}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap align-top font-medium text-success-700">
                {bagsIn !== null && !opening ? `+ ${formatBags(bagsIn)}` : "-"}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap align-top font-medium text-danger-700">
                {bagsOut !== null ? `− ${formatBags(bagsOut)}` : "-"}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap align-top">
                <div className={`font-bold ${balance !== null && balance < 0 ? "text-danger-700" : "text-warmstone-900"}`}>
                  {balance !== null ? formatBags(balance) : "-"}
                </div>
                <div className="mt-0.5 text-[11px] text-warmstone-500">
                  {opening
                    ? "Starting count"
                    : `${formatBags(before)}${bagsIn ? ` + ${formatBags(bagsIn)}` : ""}${bagsOut ? ` − ${formatBags(bagsOut)}` : ""}`}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
