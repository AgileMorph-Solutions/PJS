import { useState } from "react";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { useDateRangeFilter } from "../../components/ui/useDateRangeFilter";
import { DateRangeInputs } from "../../components/ui/DateRangeInputs";
import { RecordDetailModal } from "../../components/ui/RecordDetailModal";
import { useWarehouseActivityLedger } from "../../state/TrackingContext";
import type { WarehouseActivityLedgerEntry } from "../../repository/api";

/**
 * "Warehouse activity Ledger" — a fifth ledger-shaped page alongside the four `juteLedgers.ts`
 * ones, though it isn't one of them (it has no site column, no `real`/`col` ledger definition, and
 * gates purely on "any of its 18 columns non-blank" — see warehouseActivityLedger.ts's own header
 * comment), so it's a plain DataTable here rather than the shared LedgerSection component. Had zero
 * UI before this page (a route existed, nothing on the frontend called it).
 */
export function WarehouseActivityLedgerPage() {
  const { rows } = useWarehouseActivityLedger();
  const [detail, setDetail] = useState<WarehouseActivityLedgerEntry | null>(null);

  const columns: Column<WarehouseActivityLedgerEntry>[] = [
    { label: "Date", render: (r) => r.activityDate || r.activityDateRaw || "-" },
    { label: "Activity type", render: (r) => r.activityType || "-" },
    { label: "Particulars", render: (r) => r.particulars || "-" },
    { label: "Fiche No.", render: (r) => r.ficheNo || "-" },
    { label: "Lot No.", render: (r) => r.lotNo || "-" },
    { label: "Bags", render: (r) => r.bags || "-" },
    { label: "Vendor", render: (r) => r.vendor || "-" },
    {
      label: "",
      render: (r) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setDetail(r); }}
          className="text-[11.5px] font-semibold text-brand-700 hover:text-brand-800 whitespace-nowrap"
        >
          View all fields
        </button>
      ),
    },
  ];

  const dateFilter = useDateRangeFilter(rows, (r) => r.activityDate);
  const search = useTableSearch(dateFilter.filtered, (r) => [r.activityType, r.particulars, r.ficheNo, r.lotNo, r.vendor]);

  return (
    <div className="space-y-5">
      <FilterBar>
        <input
          placeholder="Search activity type, particulars, fiche, lot, vendor…"
          value={search.q}
          onChange={(e) => search.setQ(e.target.value)}
          className="w-full sm:w-72"
        />
        <DateRangeInputs value={dateFilter.range} onChange={dateFilter.setRange} />
      </FilterBar>
      <DataTable columns={columns} rows={search.filtered} keyFn={(r) => r.id} onRowClick={(r) => setDetail(r)} emptyTitle="No activity ledger rows yet" />
      {detail && (
        <RecordDetailModal title="Warehouse activity ledger entry" record={detail} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}
