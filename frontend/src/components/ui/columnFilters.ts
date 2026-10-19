/**
 * Column filters for DataTable: what a column can be filtered by, and the rule for whether a row passes.
 * Pure (no React), so the matching can be reasoned about and checked on its own.
 *
 * A column's `render()` returns JSX, which can't be read back as text, so a filterable column says what to
 * filter on with a `value(row)` of its own: the text to tick in a checklist, a number, or an ISO date.
 */
/**
 * A checklist, a number range or a date range. There is deliberately no free-text filter: typing to find something is
 * the page's main search box (and a column with too many distinct values for a checklist simply isn't filterable).
 */
export type FilterKind = "select" | "number" | "date";

export interface ColumnFilter<T> {
  /** What this column holds for a row. null / undefined / blank all count as "(blank)". */
  value: (row: T) => string | number | null | undefined;
  /** Left out, a checklist when the column has few distinct values, otherwise no filter at all. */
  kind?: FilterKind;
}

/** What the person has set for one column. Everything optional; an empty one filters nothing. */
export interface ActiveFilter {
  /** Checked values from a checklist (BLANK stands for an empty cell). */
  selected?: string[];
  min?: string;
  max?: string;
  from?: string;
  to?: string;
}

export const BLANK = "(blank)";
/** Up to this many distinct values and a column with no stated kind gets a checklist; more than that and it has none. */
export const CHECKLIST_MAX = 12;

const clean = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v).trim());
const asNumber = (s: string) => (s === "" ? NaN : Number(s.replace(/[\s,]/g, "")));

export function isActive(f: ActiveFilter | undefined): boolean {
  if (!f) return false;
  return Boolean(f.selected?.length || f.min?.trim() || f.max?.trim() || f.from || f.to);
}

export function distinctValues<T>(filter: ColumnFilter<T>, rows: T[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) seen.add(clean(filter.value(r)) || BLANK);
  // Blank last, the rest in natural order (so "BKE-2" sorts before "BKE-10").
  return [...seen].sort((a, b) => (a === BLANK ? 1 : b === BLANK ? -1 : a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })));
}

/** How a column filters, or null when it can't (no stated kind and too many distinct values for a checklist). */
export function resolveKind<T>(filter: ColumnFilter<T>, rows: T[]): FilterKind | null {
  if (filter.kind) return filter.kind;
  return distinctValues(filter, rows).length <= CHECKLIST_MAX ? "select" : null;
}

/** Does one cell value pass this column's filter? */
export function passes(kind: FilterKind, raw: string | number | null | undefined, f: ActiveFilter): boolean {
  const v = clean(raw);
  switch (kind) {
    case "select":
      return !f.selected?.length || f.selected.includes(v || BLANK);
    case "number": {
      const lo = asNumber(f.min ?? "");
      const hi = asNumber(f.max ?? "");
      if (Number.isNaN(lo) && Number.isNaN(hi)) return true;
      const n = asNumber(v);
      if (Number.isNaN(n)) return false; // a bounded filter excludes cells that have no number
      return (Number.isNaN(lo) || n >= lo) && (Number.isNaN(hi) || n <= hi);
    }
    case "date": {
      if (!f.from && !f.to) return true;
      const d = v.slice(0, 10); // ISO dates and timestamps both compare correctly as text on their first 10 characters
      if (!d) return false;
      return (!f.from || d >= f.from) && (!f.to || d <= f.to);
    }
  }
}

/** Rows that pass every column's filter. `kinds` is each filterable column's resolved kind, by column label. */
export function applyFilters<T>(
  rows: T[],
  columns: { label: string; filter?: ColumnFilter<T> }[],
  active: Record<string, ActiveFilter>,
  kinds: Record<string, FilterKind>,
): T[] {
  const live = columns.filter((c) => c.filter && kinds[c.label] && isActive(active[c.label]));
  if (!live.length) return rows;
  return rows.filter((r) => live.every((c) => passes(kinds[c.label]!, c.filter!.value(r), active[c.label]!)));
}
