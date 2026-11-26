import { useState } from "react";
import { pageWindow } from "./paging";

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
 * The current page is clamped during render rather than reset in an effect (paging.ts): filtering a list down
 * (typing in the receipts search, say) can leave `page` past the end, and clamping here corrects it
 * without a second render or a stale-page flash.
 */
export function usePagination<T>(rows: T[], pageSize = 25): PageState<T> {
  const [page, setPage] = useState(1);
  const w = pageWindow(rows.length, page, pageSize);
  return {
    pageRows: rows.slice(w.start, w.end),
    page: w.page,
    setPage,
    totalPages: w.totalPages,
    total: rows.length,
    from: w.from,
    to: w.to,
    showPager: w.showPager,
  };
}
