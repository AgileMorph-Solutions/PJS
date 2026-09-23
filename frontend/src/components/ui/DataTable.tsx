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
  /** May return undefined for a specific row to leave that row non-clickable (e.g. a historical
   * record with no matching detail page to link to) while other rows in the same table are links. */
  rowHref?: (row: T) => string | undefined;
  emptyTitle?: string;
  emptyHint?: string;
}

export function DataTable<T>({ columns, rows, keyFn, rowHref, emptyTitle, emptyHint }: Props<T>) {
  const navigate = useNavigate();

  if (rows.length === 0) {
    return <EmptyState title={emptyTitle ?? "Nothing here yet"} hint={emptyHint} />;
  }

  function onKeyDown(e: KeyboardEvent<HTMLTableRowElement>, href: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      navigate(href);
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
          {rows.map((row) => {
            const href = rowHref?.(row);
            return (
              <tr
                key={keyFn(row)}
                className={`border-b border-warmstone-100 last:border-0 ${
                  href ? "cursor-pointer hover:bg-warmstone-50 focus-visible:bg-warmstone-50 outline-none" : ""
                }`}
                onClick={href ? () => navigate(href) : undefined}
                role={href ? "button" : undefined}
                tabIndex={href ? 0 : undefined}
                onKeyDown={href ? (e) => onKeyDown(e, href) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.label} className="px-4 py-3 text-warmstone-800 align-middle">
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
