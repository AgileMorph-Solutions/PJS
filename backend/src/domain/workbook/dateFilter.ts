/**
 * The date range on "Export data". Same rule the rest of the app uses for a date filter (see the
 * frontend's useDateRangeFilter): a row with no usable date can't be compared, so it is left out
 * whenever a range is set and included when it isn't. Left-out rows are COUNTED and reported back
 * rather than vanishing — several tables genuinely hold rows whose date was hand-typed text that
 * we deliberately keep verbatim instead of reinterpreting (see the *Raw date columns in the
 * schema), and someone exporting "September" should be told those exist.
 */
import { ValidationError } from "../validation.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export interface DateRange { from?: string; to?: string }

/** Both bounds optional and inclusive; anything present must be a real `YYYY-MM-DD`. */
export function parseDateRange(from?: string, to?: string): DateRange {
  for (const [name, v] of [["from", from], ["to", to]] as const) {
    if (v && !(ISO_DATE.test(v) && isRealDate(v))) {
      throw new ValidationError(`"${name}" must be a real date as YYYY-MM-DD (got "${v}").`);
    }
  }
  if (from && to && from > to) throw new ValidationError(`"from" (${from}) is after "to" (${to}).`);
  return { from: from || undefined, to: to || undefined };
}

/** A row's date as `YYYY-MM-DD`, or null when it has none we can trust: a real Date, or an ISO
 * date/datetime string. Text like "13-01-2026" is NOT guessed at. */
export function isoDateOf(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof value === "string" && ISO_DATE.test(value.slice(0, 10)) && isRealDate(value.slice(0, 10))) {
    return value.slice(0, 10);
  }
  return null;
}

export function filterByDate<T extends Record<string, unknown>>(
  rows: T[], column: string, range: DateRange
): { rows: T[]; withoutDate: number } {
  if (!range.from && !range.to) return { rows, withoutDate: 0 };
  let withoutDate = 0;
  const kept = rows.filter((r) => {
    const d = isoDateOf(r[column]);
    if (!d) { withoutDate++; return false; }
    return (!range.from || d >= range.from) && (!range.to || d <= range.to);
  });
  return { rows: kept, withoutDate };
}

/** `Receipts 2026-09-30.xlsx`, or `Receipts 2026-09-01 to 2026-09-30.xlsx` for a range (an open end
 * reads "start"/"end"). */
export function exportFilename(label: string, range: DateRange, today: string): string {
  const span = range.from || range.to ? `${range.from ?? "start"} to ${range.to ?? "end"}` : today;
  return `${label} ${span}.xlsx`;
}
