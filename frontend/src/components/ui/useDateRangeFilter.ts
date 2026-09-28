import { useState } from "react";
import type { DateRange } from "./DateRangeInputs";

/**
 * Client-side date-range filter — the date-column sibling of `useTableSearch`. Narrows `rows` to
 * those whose `field(row)` string falls within [from, to] inclusive, via plain string comparison:
 * valid because every normalized date field in this app is stored/wire-formatted as ISO
 * "YYYY-MM-DD", which sorts chronologically as plain text (same trick the dashboard's own date
 * filter and the backend's `/api/dashboard?from=&to=` route use).
 *
 * A row with no value for `field` is excluded whenever a range is active (there's nothing to
 * compare it against) and included when the range is empty (unfiltered = show everything,
 * including gaps) — mirrors how the rest of the app treats a missing/`*Raw`-only date.
 */
export function useDateRangeFilter<T>(rows: T[], field: (row: T) => string | null | undefined) {
  const [range, setRange] = useState<DateRange>({ from: "", to: "" });
  const active = Boolean(range.from || range.to);
  const filtered = active
    ? rows.filter((r) => {
        const d = field(r);
        if (!d) return false;
        if (range.from && d < range.from) return false;
        if (range.to && d > range.to) return false;
        return true;
      })
    : rows;
  return { range, setRange, filtered };
}
