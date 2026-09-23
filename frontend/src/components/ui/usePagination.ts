import { useState } from "react";

export interface PageState<T> {
  pageRows: T[];
  page: number;
  setPage: (page: number) => void;
  totalPages: number;
  total: number;
  /** 1-based index of the first row on this page; 0 when there are no rows at all. */
  from: number;
  to: number;
  showPager: boolean;
}

/**
 * Client-side paging. Every list in this app arrives fully loaded (TrackingContext holds the whole
 * dataset), so there is nothing to fetch per page.
 *
 * The current page is clamped during render rather than reset in an effect: filtering a list down
 * (typing in the receipts search, say) can leave `page` past the end, and clamping here corrects it
 * without a second render or a stale-page flash.
 */
export function usePagination<T>(rows: T[], pageSize = 25): PageState<T> {
  const [page, setPage] = useState(1);
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(page, 1), totalPages);
  const start = (current - 1) * pageSize;

  return {
    pageRows: rows.slice(start, start + pageSize),
    page: current,
    setPage,
    totalPages,
    total,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + pageSize, total),
    showPager: total > pageSize,
  };
}
