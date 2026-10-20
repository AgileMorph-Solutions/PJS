import { DateInput } from "./DateInput";

export interface DateRange {
  from: string;
  to: string;
}

interface Props {
  value: DateRange;
  onChange: (value: DateRange) => void;
}

/**
 * Compact from/to date pair for a FilterBar row, styled entirely by FilterBar's own `[&_input]`
 * descendant rules — this is just the two inputs plus a clear affordance, not another themed
 * wrapper. Contrast `components/dashboard/DateRangeFilter`, which owns its own full-width card;
 * that one scopes an entire dashboard, this one is one filter among several in a table's FilterBar.
 */
export function DateRangeInputs({ value, onChange }: Props) {
  const isFiltered = Boolean(value.from || value.to);
  return (
    <div className="flex items-center gap-1.5">
      <DateInput aria-label="From date" value={value.from} max={value.to || undefined} onChange={(from) => onChange({ ...value, from })} />
      <span className="text-warmstone-400 text-[12px]" aria-hidden="true">
        &ndash;
      </span>
      <DateInput aria-label="To date" value={value.to} min={value.from || undefined} onChange={(to) => onChange({ ...value, to })} />
      {isFiltered && (
        <button
          type="button"
          onClick={() => onChange({ from: "", to: "" })}
          title="Clear date filter"
          className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-warmstone-400 hover:text-warmstone-700 hover:bg-warmstone-100 transition-colors"
        >
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      )}
    </div>
  );
}
