import { CalendarRange, RotateCcw } from "lucide-react";

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
    <div className="dashboard-filter-bar">
      <span className="kpi-icon" style={{ marginBottom: 0 }} aria-hidden="true">
        <CalendarRange />
      </span>
      <div className="dashboard-filter-field">
        <label htmlFor="dashboard-filter-from">From</label>
        <input
          id="dashboard-filter-from"
          type="date"
          value={value.from}
          max={value.to || undefined}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
        />
      </div>
      <div className="dashboard-filter-field">
        <label htmlFor="dashboard-filter-to">To</label>
        <input
          id="dashboard-filter-to"
          type="date"
          value={value.to}
          min={value.from || undefined}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
        />
      </div>
      <button
        type="button"
        className="dashboard-filter-reset"
        disabled={!isFiltered}
        onClick={() => onChange({ from: "", to: "" })}
      >
        <RotateCcw size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
        All time
      </button>
      {isFiltered && (
        <span className="dashboard-filter-note">
          Showing {value.from || "the start"} to {value.to || "now"} — every figure below is scoped
          to this range.
        </span>
      )}
    </div>
  );
}
