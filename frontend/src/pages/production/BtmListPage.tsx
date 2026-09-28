import { useState } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { useDateRangeFilter } from "../../components/ui/useDateRangeFilter";
import { DateRangeInputs } from "../../components/ui/DateRangeInputs";
import { useBtmIntakes } from "../../state/TrackingContext";
import { api, type BtmIntake } from "../../repository/api";

/** BTM register — the intake spine's list page. A BTM is auto-created the moment its first
 * receipt line is written (see backend/src/services/production/btm.ts), so "create a BTM" here is
 * really "record its first receipt line"; the destination Bin is fixed from that first write on
 * (confirmed rule — a BTM lands in exactly one Bin). */
export function BtmListPage() {
  const { rows, loading, refetch } = useBtmIntakes();
  const [btmNo, setBtmNo] = useState("");
  const [binNo, setBinNo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!btmNo.trim() || !binNo.trim()) { setError("BTM No and destination Bin No are both required."); return; }
    setSaving(true);
    setError(null);
    try {
      await api.addBtmRow(btmNo.trim(), "receipt-lines", binNo.trim(), {});
      setBtmNo("");
      setBinNo("");
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<BtmIntake>[] = [
    { label: "BTM No", render: (r) => <span className="font-mono text-[12.5px] font-semibold">{r.btmNo}</span> },
    { label: "Destination Bin", render: (r) => r.binNo },
    { label: "Source", render: (r) => r.source ?? "—" },
    { label: "Recorded", render: (r) => new Date(r.createdAt).toLocaleDateString() },
  ];

  const dateFilter = useDateRangeFilter(rows, (r) => r.createdAt?.slice(0, 10));
  const search = useTableSearch(dateFilter.filtered, (r) => [r.btmNo, r.binNo, r.source]);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Production · Phase 1–2"
        title="BTM Intake"
        lede="A BTM (Bordereau de Transfer) is the transfer slip warehouse writes when RCN leaves a procurement bin for the central warehouse. It always lands in exactly one production Bin."
      />

      <div className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs">
        <h3 className="text-[15px] font-bold text-warmstone-900 mb-3">Record a new BTM</h3>
        <div className="grid sm:grid-cols-3 gap-4 items-end">
          <div>
            <label className="text-[12.5px] font-semibold text-warmstone-700 block mb-1.5">BTM No</label>
            <input
              value={btmNo}
              onChange={(e) => setBtmNo(e.target.value)}
              placeholder="e.g. 1001"
              className="w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13.5px] outline-none focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700"
            />
          </div>
          <div>
            <label className="text-[12.5px] font-semibold text-warmstone-700 block mb-1.5">Destination Bin No</label>
            <input
              value={binNo}
              onChange={(e) => setBinNo(e.target.value)}
              placeholder="e.g. ANA-01"
              className="w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13.5px] outline-none focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold transition-all shadow-sm disabled:opacity-50 h-[38px]"
          >
            {saving ? "Saving…" : "Record BTM"}
          </button>
        </div>
        {error && <p className="text-[12.5px] text-danger-700 mt-3">{error}</p>}
      </div>

      {!loading && (
        <>
          <FilterBar>
            <input
              placeholder="Search BTM No, bin, source…"
              value={search.q}
              onChange={(e) => search.setQ(e.target.value)}
              className="w-full sm:w-64"
            />
            <DateRangeInputs value={dateFilter.range} onChange={dateFilter.setRange} />
          </FilterBar>
          <DataTable
            columns={columns}
            rows={search.filtered}
            keyFn={(r) => r.btmNo}
            rowHref={(r) => `/production/btm/${encodeURIComponent(r.btmNo)}`}
            emptyTitle="No BTMs recorded yet"
            emptyHint="Record the first one above, or import from a workbook once the importer lands."
          />
        </>
      )}
    </div>
  );
}
