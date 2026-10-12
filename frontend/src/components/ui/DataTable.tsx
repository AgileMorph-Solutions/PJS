import type { ReactNode, KeyboardEvent, MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "./EmptyState";
import { usePagination } from "./usePagination";
import { Pagination } from "./Pagination";

export interface Column<T> {
  label: string;
  render: (row: T) => ReactNode;
  width?: string;
  /** Keep this column's cells on one line (IDs, codes) so a narrow table squeezes the free-text
   * columns instead of breaking a value mid-way. */
  nowrap?: boolean;
  /** Numbers and kg read best lined up on the right. */
  align?: "right";
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  keyFn: (row: T) => string;
  /** May return undefined for a specific row to leave that row non-clickable (e.g. a historical
   * record with no matching detail page to link to) while other rows in the same table are links. */
  rowHref?: (row: T) => string | undefined;
  /** For tables whose detail is a modal rather than a page. */
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyHint?: string;
}

/** A click on something that is already interactive inside the row (a link, a button, an input) does its
 * own thing; it must not also open the row. */
const fromControl = (e: MouseEvent | KeyboardEvent) =>
  e.target instanceof Element && e.target.closest("a,button,input,select,textarea,label") !== null && e.target !== e.currentTarget;

export function DataTable<T>({ columns, rows, keyFn, rowHref, onRowClick, emptyTitle, emptyHint }: Props<T>) {
  const navigate = useNavigate();
  const page = usePagination(rows);

  if (rows.length === 0) {
    return <EmptyState title={emptyTitle ?? "Nothing here yet"} hint={emptyHint} />;
  }

  const actionFor = (row: T): (() => void) | undefined => {
    const href = rowHref?.(row);
    if (href) return () => navigate(href);
    if (onRowClick) return () => onRowClick(row);
    return undefined;
  };
  const anyClickable = Boolean(rowHref || onRowClick);
  const align = (c: Column<T>) => (c.align === "right" ? "text-right" : "text-left");

  return (
    <div className="overflow-x-auto bg-white border border-warmstone-200 rounded-2xl shadow-xs">
      <table className="w-full text-[13px] border-collapse">
        <thead className="sticky top-0 z-10">
          <tr className="bg-warmstone-50 border-b border-warmstone-200">
            {columns.map((c) => (
              <th
                key={c.label}
                style={c.width ? { width: c.width } : undefined}
                className={`${align(c)} px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-warmstone-500 whitespace-nowrap`}
              >
                {c.label}
              </th>
            ))}
            {anyClickable && <th aria-hidden className="w-8" />}
          </tr>
        </thead>
        <tbody>
          {page.pageRows.map((row) => {
            const action = actionFor(row);
            return (
              <tr
                key={keyFn(row)}
                className={`group border-b border-warmstone-100 last:border-0 transition-colors ${
                  action ? "cursor-pointer hover:bg-brand-50/40 focus-visible:bg-brand-50/40 outline-none" : "hover:bg-warmstone-50/60"
                }`}
                onClick={action ? (e) => { if (!fromControl(e)) action(); } : undefined}
                role={action ? "link" : undefined}
                tabIndex={action ? 0 : undefined}
                onKeyDown={action ? (e) => { if ((e.key === "Enter" || e.key === " ") && !fromControl(e)) { e.preventDefault(); action(); } } : undefined}
              >
                {columns.map((c) => (
                  <td key={c.label} className={`${align(c)} px-4 py-3.5 text-warmstone-800 align-middle ${c.nowrap ? "whitespace-nowrap" : ""} ${c.align === "right" ? "tabular-nums" : ""}`}>
                    {c.render(row)}
                  </td>
                ))}
                {anyClickable && (
                  <td className="pr-3 text-right align-middle">
                    {action && <span aria-hidden className="material-symbols-outlined text-[18px] text-warmstone-300 group-hover:text-brand-700 transition-colors">chevron_right</span>}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <Pagination state={page} />
    </div>
  );
}
