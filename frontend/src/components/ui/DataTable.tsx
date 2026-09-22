import type { ReactNode, KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "./EmptyState";

export interface Column<T> {
  label: string;
  render: (row: T) => ReactNode;
  width?: string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  keyFn: (row: T) => string;
  rowHref?: (row: T) => string;
  emptyTitle?: string;
  emptyHint?: string;
}

export function DataTable<T>({ columns, rows, keyFn, rowHref, emptyTitle, emptyHint }: Props<T>) {
  const navigate = useNavigate();

  if (rows.length === 0) {
    return <EmptyState title={emptyTitle ?? "Nothing here yet"} hint={emptyHint} />;
  }

  function go(row: T) {
    if (rowHref) navigate(rowHref(row));
  }
  function onKeyDown(e: KeyboardEvent<HTMLTableRowElement>, row: T) {
    if (rowHref && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      go(row);
    }
  }

  return (
    <div className="overflow-x-auto bg-white border border-warmstone-200 rounded-2xl shadow-xs">
      <table className="w-full text-[13px] border-collapse">
        <thead>
          <tr className="border-b border-warmstone-200">
            {columns.map((c) => (
              <th
                key={c.label}
                style={c.width ? { width: c.width } : undefined}
                className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-warmstone-500 whitespace-nowrap"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={keyFn(row)}
              className={`border-b border-warmstone-100 last:border-0 ${
                rowHref ? "cursor-pointer hover:bg-warmstone-50 focus-visible:bg-warmstone-50 outline-none" : ""
              }`}
              onClick={rowHref ? () => go(row) : undefined}
              role={rowHref ? "button" : undefined}
              tabIndex={rowHref ? 0 : undefined}
              onKeyDown={rowHref ? (e) => onKeyDown(e, row) : undefined}
            >
              {columns.map((c) => (
                <td key={c.label} className="px-4 py-3 text-warmstone-800 align-middle">
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
