import { useMemo, useState } from "react";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { useDateRangeFilter } from "../../components/ui/useDateRangeFilter";
import { DateRangeInputs } from "../../components/ui/DateRangeInputs";
import { RecordDetailModal } from "../../components/ui/RecordDetailModal";
import { useTracking, useWarehouseActivityLedger } from "../../state/TrackingContext";
import { useCanEditDirectly } from "../../state/AuthContext";
import { useActiveSite } from "../../state/SiteContext";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { ActivityForm } from "../../components/warehouse/ActivityForm";
import { ACTIVITY_LABEL, classifyActivity } from "@anagroci/contract/data/warehouseActivities";
import type { WarehouseActivityLedgerEntry } from "../../repository/api";
import { formatDate } from "@anagroci/contract/domain/dateFormat";

/**
 * "Warehouse activity Ledger" — a fifth ledger-shaped page alongside the four `juteLedgers.ts`
 * ones, though it isn't one of them (it has no site column, no `real`/`col` ledger definition, and
 * gates purely on "any of its 18 columns non-blank" — see warehouseActivityLedger.ts's own header
 * comment), so it's a plain DataTable here rather than the shared LedgerSection component. Had zero
 * UI before this page (a route existed, nothing on the frontend called it).
 */
export function WarehouseActivityLedgerPage() {
  const { rows, refetch } = useWarehouseActivityLedger();
  const { receipts, masters } = useTracking();
  const canEdit = useCanEditDirectly();
  const site = useActiveSite();
  // The places an activity can be at: this warehouse's stores, and the known Bins.
  const places = useMemo(() => [...masters.warehouses.filter((w) => w.site === site.warehouseName).map((w) => w.name).sort(), ...masters.bins], [masters.warehouses, masters.bins, site.warehouseName]);
  const [detail, setDetail] = useState<WarehouseActivityLedgerEntry | null>(null);

  const columns: Column<WarehouseActivityLedgerEntry>[] = [
    { label: "Date", filter: { value: (r) => r.activityDate || r.activityDateRaw, kind: "date" }, render: (r) => formatDate(r.activityDate || r.activityDateRaw) || "-" },
    // One classification for every row, imported or recorded here, from its activity text (contract data/warehouseActivities.ts).
    // The text itself is left exactly as the sheet wrote it, so this reads it and never rewrites it.
    { label: "Category", filter: { value: (r) => ACTIVITY_LABEL[classifyActivity(r.activityType)] }, render: (r) => ACTIVITY_LABEL[classifyActivity(r.activityType)] },
    { label: "Activity type", render: (r) => r.activityType || "-" },
    { label: "Particulars", render: (r) => r.particulars || "-" },
    { label: "Fiche No.", render: (r) => r.ficheNo || "-" },
    { label: "Lot No.", render: (r) => r.lotNo || "-" },
    { label: "Bags", filter: { value: (r) => r.bags, kind: "number" }, render: (r) => r.bags || "-" },
    { label: "Vendor", filter: { value: (r) => r.vendor }, render: (r) => r.vendor || "-" },
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
  const search = useTableSearch(dateFilter.filtered, (r) => [r.activityType, ACTIVITY_LABEL[classifyActivity(r.activityType)], r.particulars, r.ficheNo, r.lotNo, r.vendor]);

  return (
    <div className="space-y-5">
      {canEdit && (
        <CollapsibleCard title="Record an activity" meta={`at ${site.warehouseName}`}>
          <ActivityForm warehouse={site.warehouseName} receipts={receipts} places={places} onSaved={() => void refetch()} />
        </CollapsibleCard>
      )}
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
