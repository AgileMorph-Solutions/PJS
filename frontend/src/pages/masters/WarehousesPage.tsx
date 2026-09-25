import { useState, type FormEvent } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { usePagination } from "../../components/ui/usePagination";
import { Pagination } from "../../components/ui/Pagination";
import { useTracking } from "../../state/TrackingContext";

export function WarehousesPage() {
  const { masters, addWarehouse, receipts } = useTracking();
  const [name, setName] = useState("");
  const page = usePagination(masters.warehouses);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    addWarehouse(name.trim().toUpperCase());
    setName("");
  }

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Masters"
        title="Warehouses"
        lede="Village, Regional Central, and Factory warehouses."
      />
      <CollapsibleCard title="Add warehouse">
        <form onSubmit={handleSubmit} className="flex gap-4 items-end">
          <div className="flex-1">
            <label htmlFor="warehouse-name" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">
              Warehouse name
            </label>
            <input
              id="warehouse-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. BONDOUKOU"
              className="w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700"
            />
          </div>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold transition-all shadow-sm"
          >
            <span className="material-symbols-outlined text-[17px]">add</span>
            Add warehouse
          </button>
        </form>
      </CollapsibleCard>
      <div className="bg-white border border-warmstone-200 rounded-2xl shadow-xs divide-y divide-warmstone-100">
        {page.pageRows.map((w) => (
          <div key={w.name} className="flex items-center justify-between gap-4 px-5 py-3 text-[13px]">
            <span className="font-semibold text-warmstone-800 flex items-center gap-2">
              <span className="material-symbols-outlined text-[17px] text-brand-700">domain</span>
              {w.name}
              {w.site && <span className="text-warmstone-400 font-normal">({w.site})</span>}
            </span>
            <span className="text-warmstone-500 tabular-nums">{receipts.filter((r) => r.warehouse === w.name).length} receipts</span>
          </div>
        ))}
        <Pagination state={page} />
      </div>
    </div>
  );
}
