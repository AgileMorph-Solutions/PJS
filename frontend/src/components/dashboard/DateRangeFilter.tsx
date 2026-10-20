import { DateInput } from "../ui/DateInput";
import { formatDate } from "@anagroci/contract/domain/dateFormat";

export interface DateRange {
  from: string;
  to: string;
}

interface Props {
  value: DateRange;
  onChange: (value: DateRange) => void;
}

/**
 * A single filter row above the dashboard's content, scoping the KPI tiles, both charts, and
 * "Recent activity" together — never a per-chart filter (per the dataviz skill's composition
 * rule: one row, above the charts, everything below re-renders against the same slice).
 *
 * Purely client-side: `receipts` and `ledgerEntries` are already fully loaded by TrackingContext,
 * so this filters the in-memory arrays by `arrivalDate`/`Date` string comparison — the same
 * lexicographic-is-chronological trick the backend's own `/api/dashboard?from=&to=` route already
 * uses — rather than adding a network round trip.
 */
export function DateRangeFilter({ value, onChange }: Props) {
  const isFiltered = Boolean(value.from || value.to);

  return (
    <div className="flex flex-wrap items-end gap-4 bg-white border border-warmstone-200 rounded-2xl px-5 py-4 mb-5 shadow-xs">
      <span className="material-symbols-outlined text-warmstone-400 text-[20px] mb-1.5" aria-hidden="true">
        calendar_month
      </span>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="dashboard-filter-from" className="text-[11px] font-bold uppercase tracking-wider text-warmstone-500">
          From
        </label>
        <DateInput id="dashboard-filter-from" value={value.from} max={value.to || undefined} onChange={(from) => onChange({ ...value, from })} className="px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 outline-none focus:border-brand-700 focus:ring-1 focus:ring-brand-700" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="dashboard-filter-to" className="text-[11px] font-bold uppercase tracking-wider text-warmstone-500">
          To
        </label>
        <DateInput id="dashboard-filter-to" value={value.to} min={value.from || undefined} onChange={(to) => onChange({ ...value, to })} className="px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 outline-none focus:border-brand-700 focus:ring-1 focus:ring-brand-700" />
      </div>
      <button
        type="button"
        disabled={!isFiltered}
        onClick={() => onChange({ from: "", to: "" })}
        className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-warmstone-200 text-[11px] font-bold uppercase tracking-wider text-warmstone-500 hover:text-warmstone-900 hover:border-brand-700 transition-colors disabled:opacity-40 disabled:pointer-events-none"
      >
        <span className="material-symbols-outlined text-[14px]">restart_alt</span>
        All time
      </button>
      {isFiltered && (
        <span className="text-[12px] text-warmstone-500 ml-auto self-center">
          Showing {formatDate(value.from) || "the start"} to {formatDate(value.to) || "now"} - every figure below is scoped to this range.
        </span>
      )}
    </div>
  );
}
