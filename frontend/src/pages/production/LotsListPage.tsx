import { useState } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { useDateRangeFilter } from "../../components/ui/useDateRangeFilter";
import { DateRangeInputs } from "../../components/ui/DateRangeInputs";
import { useProductionLots } from "../../state/TrackingContext";
import { api, type ProductionLot } from "../../repository/api";

/** A Lot is created at Cooking, never before (confirmed rule) — so "create a Lot" here really means
 * "cook the first batch", exactly mirroring the BTM list page's "create = first receipt line". */
export function LotsListPage() {
  const { rows, loading, refetch } = useProductionLots();
  const [lotNo, setLotNo] = useState("");
  const [binNo, setBinNo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCook() {
    if (!lotNo.trim() || !binNo.trim()) { setError("Lot No and Bin No are both required."); return; }
    setSaving(true);
    setError(null);
    try {
      await api.cookLot(lotNo.trim(), binNo.trim(), {});
      setLotNo("");
      setBinNo("");
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<ProductionLot>[] = [
    { label: "Lot No", render: (r) => <span className="font-mono text-[12.5px] font-semibold">{r.lotNo}</span> },
    { label: "Bin", render: (r) => r.binNo },
    { label: "Source", render: (r) => r.source ?? "-" },
    { label: "Created", render: (r) => new Date(r.createdAt).toLocaleDateString() },
  ];

  const dateFilter = useDateRangeFilter(rows, (r) => r.createdAt?.slice(0, 10));
  const search = useTableSearch(dateFilter.filtered, (r) => [r.lotNo, r.binNo, r.source]);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Production · Phase 3–8"
        title="Lots"
        lede="A Lot is created at Cooking and carries through Shelling, Borma, and Packing - always belonging to exactly one Bin."
      />

      <div className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs">
        <h3 className="text-[15px] font-bold text-warmstone-900 mb-3">Cook a new Lot</h3>
        <div className="grid sm:grid-cols-3 gap-4 items-end">
          <div>
            <label className="text-[12.5px] font-semibold text-warmstone-700 block mb-1.5">Lot No</label>
            <input
              value={lotNo}
              onChange={(e) => setLotNo(e.target.value)}
              placeholder="e.g. ANG26E01"
              className="w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13.5px] outline-none focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700"
            />
          </div>
          <div>
            <label className="text-[12.5px] font-semibold text-warmstone-700 block mb-1.5">Bin No</label>
            <input
              value={binNo}
              onChange={(e) => setBinNo(e.target.value)}
              placeholder="e.g. ANA-01"
              className="w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13.5px] outline-none focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleCook()}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold transition-all shadow-sm disabled:opacity-50 h-[38px]"
          >
            {saving ? "Saving…" : "Cook Lot"}
          </button>
        </div>
        {error && <p className="text-[12.5px] text-danger-700 mt-3">{error}</p>}
      </div>

      {!loading && (
        <>
          <FilterBar>
            <input
              placeholder="Search Lot No, bin, source…"
              value={search.q}
              onChange={(e) => search.setQ(e.target.value)}
              className="w-full sm:w-64"
            />
            <DateRangeInputs value={dateFilter.range} onChange={dateFilter.setRange} />
          </FilterBar>
          <DataTable
            columns={columns}
            rows={search.filtered}
            keyFn={(r) => r.lotNo}
            rowHref={(r) => `/production/lots/${encodeURIComponent(r.lotNo)}`}
            emptyTitle="No Lots cooked yet"
          />
        </>
      )}
    </div>
  );
}
