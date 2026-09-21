import type { ReactNode } from "react";
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

  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.label} style={c.width ? { width: c.width } : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={keyFn(row)}
              className={rowHref ? "clickable" : undefined}
              onClick={rowHref ? () => navigate(rowHref(row)) : undefined}
            >
              {columns.map((c) => (
                <td key={c.label}>{c.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
