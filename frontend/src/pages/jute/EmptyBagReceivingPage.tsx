import { formatDate } from "@anagroci/contract/domain/dateFormat";
import { EmptyBagReceiptForm } from "../../components/jute/EmptyBagReceiptForm";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { DateRangeInputs } from "../../components/ui/DateRangeInputs";
import { FilterBar } from "../../components/ui/FilterBar";
import { useDateRangeFilter } from "../../components/ui/useDateRangeFilter";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { SITE_LIST } from "../../config/sites";
import type { EmptyBagReceiptRow } from "../../repository/api";
import { useCanEditDirectly } from "../../state/AuthContext";
import { useActiveSite } from "../../state/SiteContext";
import { useEmptyBagReceipts, useTracking } from "../../state/TrackingContext";

const columns: Column<EmptyBagReceiptRow>[] = [
  { label: "Date", filter: { value: (r) => r.date, kind: "date" }, nowrap: true, render: (r) => formatDate(r.date) || "-" },
  { label: "From warehouse", filter: { value: (r) => r.fromWarehouse }, render: (r) => r.fromWarehouse },
  { label: "Received at", render: (r) => r.warehouse },
  { label: "Truck number", render: (r) => r.truckNumber || "-" },
  { label: "Warehouse receipt no.", render: (r) => <span className="font-mono text-[12.5px]">{r.warehouseReceiptNo || "-"}</span> },
  { label: "Bags received", filter: { value: (r) => r.bagsReceived, kind: "number" }, render: (r) => r.bagsReceived.toLocaleString() },
  { label: "Responsible person/team", render: (r) => r.responsibleParty },
  { label: "Entered by", render: (r) => r.createdBy || "-" },
];

export function EmptyBagReceivingPage() {
  const site = useActiveSite();
  const canEdit = useCanEditDirectly();
  const { refresh } = useTracking();
  const { rows, loading, refetch } = useEmptyBagReceipts(site.warehouseName);
  const dateFilter = useDateRangeFilter(rows, (r) => r.date ?? undefined);
  const search = useTableSearch(dateFilter.filtered, (r) => [r.fromWarehouse, r.truckNumber ?? "", r.warehouseReceiptNo ?? "", r.responsibleParty]);

  return (
    <div className="space-y-5">
      {canEdit && (
        <CollapsibleCard title="Record empty bags received" meta={`at ${site.warehouseName}`}>
          <EmptyBagReceiptForm
            // A different warehouse has different places the bags can come from, so start its form afresh.
            key={site.warehouseName}
            warehouse={site.warehouseName}
            fromOptions={SITE_LIST.map((s) => s.warehouseName).filter((w) => w !== site.warehouseName)}
            // The new stock row belongs to the shared ledger list too, so the Warehouse Stock tab shows it straight away.
            onSaved={() => { void refetch(); void refresh(); }}
          />
        </CollapsibleCard>
      )}
      <FilterBar>
        <input
          placeholder="Search warehouse, truck, receipt no., person…"
          value={search.q}
          onChange={(e) => search.setQ(e.target.value)}
          className="w-full sm:w-72"
        />
        <DateRangeInputs value={dateFilter.range} onChange={dateFilter.setRange} />
      </FilterBar>
      <DataTable
        columns={columns}
        rows={search.filtered}
        keyFn={(r) => r.id}
        emptyTitle={loading ? "Loading…" : "No empty bags received from another warehouse yet"}
      />
    </div>
  );
}
