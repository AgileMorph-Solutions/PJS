import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { FilterBar } from "../../components/ui/FilterBar";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { usePagination } from "../../components/ui/usePagination";
import { Pagination } from "../../components/ui/Pagination";
import { useTracking } from "../../state/TrackingContext";
import { api } from "../../repository/api";

const inputCls =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700";

export function BinsPage() {
  const { masters, receipts, refresh } = useTracking();
  const [name, setName] = useState("");
  const [store, setStore] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The stores a Bin can be in: every warehouse row that belongs to a site (BKE-001, ANAGROCI-01, ...).
  const stores = useMemo(() => masters.warehouses.filter((w) => w.site).map((w) => w.name).sort(), [masters.warehouses]);
  const storeOf = useMemo(() => new Map((masters.binInfo ?? []).map((b) => [b.code, b.store])), [masters.binInfo]);
  const search = useTableSearch(masters.bins, (b) => [b, storeOf.get(b)]);
  const page = usePagination(search.filtered);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null); setNotice(null);
    try {
      await api.createBin(name, store);
      await refresh();
      setNotice(`Bin ${name.trim().toUpperCase()} added to ${store}.`);
      setName("");
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Masters"
        title="Bins"
        lede="A Bin can hold several different Lots at once."
      />
      <CollapsibleCard title="Add bin">
        <form onSubmit={(e) => void handleSubmit(e)} className="grid sm:grid-cols-[1fr_1fr_auto] gap-4 items-end">
          <div>
            <label htmlFor="bin-code" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">Bin code</label>
            <input id="bin-code" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. BKE-001-BIN-004" className={inputCls} />
          </div>
          <div>
            <label htmlFor="bin-store" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">Store it is in</label>
            <select id="bin-store" required value={store} onChange={(e) => setStore(e.target.value)} className={inputCls}>
              <option value="">Choose a store…</option>
              {stores.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <button type="submit" disabled={saving || !name.trim() || !store} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white text-[13px] font-bold transition-all shadow-sm">
            <span className="material-symbols-outlined text-[17px]">add</span>
            Add bin
          </button>
        </form>
        {error && <p role="alert" className="mt-3 text-[13px] text-danger-700">{error}</p>}
        {notice && <p className="mt-3 text-[13px] text-success-700">{notice}</p>}
      </CollapsibleCard>
      <FilterBar>
        <input
          placeholder="Search bin code or store…"
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
              {storeOf.get(b) && <span className="font-sans font-normal text-[12px] text-warmstone-400">· {storeOf.get(b)}</span>}
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
