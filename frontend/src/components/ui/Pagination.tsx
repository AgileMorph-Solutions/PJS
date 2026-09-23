import type { PageState } from "./usePagination";

export function Pagination({ state }: { state: PageState<unknown> }) {
  if (!state.showPager) return null;
  const { page, totalPages, from, to, total, setPage } = state;

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 border-t border-warmstone-100 text-[12.5px] text-warmstone-500">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setPage(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className="p-1.5 rounded-lg text-warmstone-600 hover:bg-warmstone-100 disabled:opacity-30 disabled:pointer-events-none"
        >
          <span className="material-symbols-outlined text-[18px]">chevron_left</span>
        </button>
        <span className="font-medium text-warmstone-700 tabular-nums">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => setPage(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
          className="p-1.5 rounded-lg text-warmstone-600 hover:bg-warmstone-100 disabled:opacity-30 disabled:pointer-events-none"
        >
          <span className="material-symbols-outlined text-[18px]">chevron_right</span>
        </button>
      </div>
    </div>
  );
}
