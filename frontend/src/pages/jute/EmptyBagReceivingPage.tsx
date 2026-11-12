import { useState } from "react";
import { formatDate } from "@anagroci/contract/domain/dateFormat";
import { EmptyBagReceiptForm } from "../../components/jute/EmptyBagReceiptForm";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { DateRangeInputs } from "../../components/ui/DateRangeInputs";
import { FilterBar } from "../../components/ui/FilterBar";
import { useDateRangeFilter } from "../../components/ui/useDateRangeFilter";
import { useTableSearch } from "../../components/ui/useTableSearch";
import type { EmptyBagReceiptRow } from "../../repository/api";
import { useCanEditDirectly } from "../../state/AuthContext";
import { useEmptyBagReceipts, useEmptyBagSources, useTracking } from "../../state/TrackingContext";
import { useWarehouseChoices } from "../../state/useWarehouseChoices";

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
  const canEdit = useCanEditDirectly();
  const { refresh } = useTracking();
  const { own, all } = useWarehouseChoices();
  // Where bags can come from is every warehouse — a Warehouse Incharge's own list (`all`) holds only theirs.
  const sources = useEmptyBagSources();
  // The list follows the choice, so what was just saved is on screen; with none chosen it shows every warehouse.
  const [picked, setPicked] = useState("");
  const receiving = own ?? picked;
  const { rows, loading, refetch } = useEmptyBagReceipts(receiving || undefined);
  const dateFilter = useDateRangeFilter(rows, (r) => r.date ?? undefined);
  const search = useTableSearch(dateFilter.filtered, (r) => [r.fromWarehouse, r.truckNumber ?? "", r.warehouseReceiptNo ?? "", r.responsibleParty]);

  return (
    <div className="space-y-5">
      {canEdit && (
        <CollapsibleCard title="Record empty bags received" meta={receiving ? `at ${receiving}` : "choose a warehouse"}>
          <EmptyBagReceiptForm
            warehouse={receiving}
            warehouses={all}
            sources={sources}
            fixed={own !== null}
            onWarehouseChange={setPicked}
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
