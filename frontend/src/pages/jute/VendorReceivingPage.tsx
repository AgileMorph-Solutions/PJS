import { useState } from "react";
import { shortQuantityLabel } from "@anagroci/contract/domain/juteVendorReceipt";
import { formatDate } from "@anagroci/contract/domain/dateFormat";
import { VendorReceiptForm } from "../../components/jute/VendorReceiptForm";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { DateRangeInputs } from "../../components/ui/DateRangeInputs";
import { FilterBar } from "../../components/ui/FilterBar";
import { useDateRangeFilter } from "../../components/ui/useDateRangeFilter";
import { useTableSearch } from "../../components/ui/useTableSearch";
import type { VendorReceiptRow } from "../../repository/api";
import { useCanEditDirectly } from "../../state/AuthContext";
import { useTracking, useVendorReceipts } from "../../state/TrackingContext";
import { useWarehouseChoices } from "../../state/useWarehouseChoices";

const columns: Column<VendorReceiptRow>[] = [
  { label: "Date", filter: { value: (r) => r.date, kind: "date" }, nowrap: true, render: (r) => formatDate(r.date) || "-" },
  { label: "Vendor", filter: { value: (r) => r.vendorName }, render: (r) => r.vendorName },
  { label: "Delivery note no.", render: (r) => <span className="font-mono text-[12.5px]">{r.deliveryNoteNo}</span> },
  { label: "Invoiced (bags)", filter: { value: (r) => r.invoicedQty, kind: "number" }, render: (r) => r.invoicedQty.toLocaleString() },
  { label: "Received (bags)", filter: { value: (r) => r.receivedQty, kind: "number" }, render: (r) => r.receivedQty.toLocaleString() },
  { label: "Short", filter: { value: (r) => r.shortQty, kind: "number" }, nowrap: true, render: (r) => shortQuantityLabel(r.shortQty) },
  { label: "Remarks", render: (r) => r.remarks || "-" },
  { label: "Entered by", render: (r) => r.createdBy || "-" },
];

export function VendorReceivingPage() {
  const canEdit = useCanEditDirectly();
  const { refresh } = useTracking();
  const { own, all } = useWarehouseChoices();
  // The list follows the choice, so what was just saved is on screen; with none chosen it shows every warehouse.
  const [picked, setPicked] = useState("");
  const receiving = own ?? picked;
  const { rows, loading, refetch } = useVendorReceipts(receiving || undefined);
  const dateFilter = useDateRangeFilter(rows, (r) => r.date ?? undefined);
  const search = useTableSearch(dateFilter.filtered, (r) => [r.vendorName, r.deliveryNoteNo, r.remarks]);

  return (
    <div className="space-y-5">
      {canEdit && (
        <CollapsibleCard title="Record bags received" meta={receiving ? `at ${receiving}` : "choose a warehouse"}>
          <VendorReceiptForm
            warehouse={receiving}
            warehouses={all}
            fixed={own !== null}
            onWarehouseChange={setPicked}
            // The new stock row belongs to the shared ledger list too, so the Warehouse Stock tab shows it straight away.
            onSaved={() => { void refetch(); void refresh(); }}
          />
        </CollapsibleCard>
      )}
      <FilterBar>
        <input
          placeholder="Search vendor, delivery note, remarks…"
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
        emptyTitle={loading ? "Loading…" : "No bags received from a vendor yet"}
      />
    </div>
  );
}
