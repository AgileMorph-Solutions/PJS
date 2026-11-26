/**
 * The page arithmetic of every table, pure so it can be checked on its own (components/ui/paging.test.ts): which rows a page
 * shows, and the page actually shown when the one asked for no longer exists (a filter left fewer rows than before).
 */
export interface PageWindow {
  /** The page shown: the one asked for, clamped to 1…totalPages. */
  page: number;
  totalPages: number;
  /** Index of the first row on the page (0-based) and one past the last, for `rows.slice(start, end)`. */
  start: number;
  end: number;
  /** 1-based "from–to of total" for the pager; from is 0 when there are no rows at all. */
  from: number;
  to: number;
  /** The pager appears only once the rows don't fit on one page. */
  showPager: boolean;
}

export function pageWindow(total: number, asked: number, pageSize: number): PageWindow {
  const size = Math.max(1, Math.floor(pageSize));
  const totalPages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(Number.isFinite(asked) ? Math.floor(asked) : 1, 1), totalPages);
  const start = (page - 1) * size;
  const end = Math.min(start + size, total);
  return { page, totalPages, start, end, from: total === 0 ? 0 : start + 1, to: end, showPager: total > size };
}
