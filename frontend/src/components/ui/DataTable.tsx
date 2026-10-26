import { useMemo, useState, type ReactNode, type KeyboardEvent, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "./EmptyState";
import { usePagination } from "./usePagination";
import { Pagination } from "./Pagination";
import { ColumnFilterMenu } from "./ColumnFilterMenu";
import { applyFilters, distinctValues, isActive, resolveKind, type ActiveFilter, type ColumnFilter, type FilterKind } from "./columnFilters";

export interface Column<T> {
  label: string;
  render: (row: T) => ReactNode;
  width?: string;
  /** Keep this column's cells on one line (IDs, codes) so a narrow table squeezes the free-text
   * columns instead of breaking a value mid-way. */
  nowrap?: boolean;
  /** Numbers and kg read best lined up on the right. */
  align?: "right";
  /** Makes the column filterable (a funnel in its header). `render()` returns JSX that can't be read back as
   * text, so say what to filter on: `{ value: (row) => row.status }`, and `kind: "number" | "date"` for ranges. */
  filter?: ColumnFilter<T>;
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
  /** Column filters already set when the table mounts, keyed by column label — for a link that opens the page
   * pre-filtered. Read once: change the table's `key` to apply a different set. */
  initialFilters?: Record<string, ActiveFilter>;
}

/** A click on something that is already interactive inside the row (a link, a button, an input) does its
 * own thing; it must not also open the row. */
const fromControl = (e: MouseEvent | KeyboardEvent) =>
  e.target instanceof Element && e.target.closest("a,button,input,select,textarea,label") !== null && e.target !== e.currentTarget;

export function DataTable<T>({ columns, rows, keyFn, rowHref, onRowClick, emptyTitle, emptyHint, initialFilters }: Props<T>) {
  const navigate = useNavigate();
  const [active, setActive] = useState<Record<string, ActiveFilter>>(initialFilters ?? {});
  // How each filterable column filters (a checklist, text, a range), decided once per set of rows rather than on every keystroke.
  const kinds = useMemo(() => {
    const out: Record<string, FilterKind> = {};
    for (const c of columns) {
      const k = c.filter ? resolveKind(c.filter, rows) : null;
      if (k) out[c.label] = k;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns.map((c) => c.label).join("|")]);
  const options = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const c of columns) if (c.filter && kinds[c.label] === "select") out[c.label] = distinctValues(c.filter, rows);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, kinds]);
  const shownRows = useMemo(() => applyFilters(rows, columns, active, kinds), [rows, columns, active, kinds]);
  const page = usePagination(shownRows);
  const activeCount = columns.filter((c) => kinds[c.label] && isActive(active[c.label])).length;
  const hasFilters = Object.keys(kinds).length > 0;

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
      {activeCount > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 bg-brand-50/60 border-b border-brand-100 text-[12.5px]">
          <span className="text-warmstone-700">
            Showing <b className="tabular-nums">{shownRows.length.toLocaleString()}</b> of <b className="tabular-nums">{rows.length.toLocaleString()}</b>
            {" "}· {activeCount} filter{activeCount === 1 ? "" : "s"} on
          </span>
          <button type="button" onClick={() => setActive({})} className="font-semibold text-brand-700 hover:text-brand-800">Clear filters</button>
        </div>
      )}
      <table className="w-full text-[13px] border-collapse">
        <thead className="sticky top-0 z-10">
          <tr className="bg-warmstone-50 border-b border-warmstone-200">
            {columns.map((c) => (
              <th
                key={c.label}
                style={c.width ? { width: c.width } : undefined}
                className={`${align(c)} px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-warmstone-500 whitespace-nowrap`}
              >
                <span className={`inline-flex items-center gap-1 ${c.align === "right" ? "flex-row-reverse" : ""}`}>
                  {c.label}
                  {kinds[c.label] && (
                    <ColumnFilterMenu
                      label={c.label} kind={kinds[c.label]!} options={options[c.label] ?? []}
                      value={active[c.label]} onChange={(next) => setActive((prev) => ({ ...prev, [c.label]: next }))}
                    />
                  )}
                </span>
              </th>
            ))}
            {anyClickable && <th aria-hidden className="w-8" />}
          </tr>
        </thead>
        <tbody>
          {hasFilters && shownRows.length === 0 && (
            <tr>
              <td colSpan={columns.length + (anyClickable ? 1 : 0)} className="px-4 py-10 text-center text-[13px] text-warmstone-500">
                No rows match these filters.{" "}
                <button type="button" onClick={() => setActive({})} className="font-semibold text-brand-700 hover:text-brand-800">Clear filters</button>
              </td>
            </tr>
          )}
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
