import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { FilterBar } from "../../components/ui/FilterBar";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { usePagination } from "../../components/ui/usePagination";
import { Pagination } from "../../components/ui/Pagination";
import { useTracking } from "../../state/TrackingContext";

export function BinsPage() {
  const { masters, addBin, receipts } = useTracking();
  const [name, setName] = useState("");
  const search = useTableSearch(masters.bins, (b) => [b]);
  const page = usePagination(search.filtered);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    addBin(name.trim().toUpperCase());
    setName("");
  }

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Masters"
        title="Bins"
        lede="A Bin can hold several different Lots at once."
      />
      <CollapsibleCard title="Add bin">
        <form onSubmit={handleSubmit} className="flex gap-4 items-end">
          <div className="flex-1">
            <label htmlFor="bin-code" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">
              Bin code
            </label>
            <input
              id="bin-code"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. BKE-004"
              className="w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700"
            />
          </div>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold transition-all shadow-sm"
          >
            <span className="material-symbols-outlined text-[17px]">add</span>
            Add bin
          </button>
        </form>
      </CollapsibleCard>
      <FilterBar>
        <input
          placeholder="Search bin code…"
          value={search.q}
          onChange={(e) => search.setQ(e.target.value)}
          className="w-full sm:w-64"
        />
      </FilterBar>
      <div className="bg-white border border-warmstone-200 rounded-2xl shadow-xs divide-y divide-warmstone-100">
        {page.pageRows.map((b) => (
          <Link
            key={b}
            to={`/masters/bins/${b}`}
            className="flex items-center justify-between gap-4 px-5 py-3 text-[13px] hover:bg-warmstone-50 transition-colors"
          >
            <span className="font-mono font-semibold text-warmstone-800 flex items-center gap-2">
              <span className="material-symbols-outlined text-[17px] text-brand-700 font-sans">inventory</span>
              {b}
            </span>
            <span className="flex items-center gap-2 text-warmstone-500 tabular-nums">
              {receipts.filter((r) => r.binNo === b).length} Lots stored
              <span className="material-symbols-outlined text-[16px] text-warmstone-300">chevron_right</span>
            </span>
          </Link>
        ))}
        <Pagination state={page} />
      </div>
    </div>
  );
}
