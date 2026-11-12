import { StatBlock } from "../ui/StatBlock";
import { bagCount, formatBags, isOpeningRow, type StockRow } from "./stockRows";

/**
 * One warehouse's stock at a glance, with the sum written out so anyone can check it: opening + bags in − bags out = stock
 * now. "Stock now" is the server's balance on the last row, not this sum, so if the two ever disagreed it would show.
 */
export function StockSummary({ warehouse, rows }: { warehouse: string; rows: StockRow[] }) {
  const opening = rows.find(isOpeningRow);
  const openingBags = bagCount(opening?.["Bags received"]) ?? 0;
  const movements = rows.filter((r) => r !== opening);
  const bagsIn = movements.reduce((sum, r) => sum + (bagCount(r["Bags received"]) ?? 0), 0);
  const bagsOut = movements.reduce((sum, r) => sum + (bagCount(r["Bags issued"]) ?? 0), 0);
  const now = rows.length ? bagCount(rows[rows.length - 1]!["Balance"]) ?? 0 : 0;

  return (
    <div className="mb-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-warmstone-500 mb-2">Stock at {warehouse}</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatBlock icon="flag" label="Opening stock" value={formatBags(openingBags)} sub={opening ? "Counted at the start" : "Not set, so starts at 0"} />
        <StatBlock icon="arrow_downward" label="Bags in" value={`+ ${formatBags(bagsIn)}`} sub="Purchased or received" tone="success" />
        <StatBlock icon="arrow_upward" label="Bags out" value={`− ${formatBags(bagsOut)}`} sub="Issued or sent out" tone="danger" />
        <StatBlock icon="inventory_2" label="Stock now" value={formatBags(now)} sub="Bags in the warehouse" />
      </div>
      <p className="mt-2 text-[12px] text-warmstone-500 tabular-nums">
        {formatBags(openingBags)} opening + {formatBags(bagsIn)} in − {formatBags(bagsOut)} out ={" "}
        <b className="font-bold text-warmstone-900">{formatBags(now)} bags now</b>
      </p>
    </div>
  );
}
