import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { useTracking } from "../../state/TrackingContext";
import type { ReceiptRecord } from "../../types/receipt";

export function StockPage() {
  const { receipts } = useTracking();
  const withLot = receipts.filter((r) => r.stageData["n-lot"] || r.stageData["n-bin"]);

  const columns: Column<ReceiptRecord>[] = [
    { label: "Lot Number", render: (r) => <span className="font-mono text-[12.5px]">{r.stageData["n-lot"]?.["Lot Number"] || r.lotNo || "—"}</span> },
    { label: "Bin Number", render: (r) => <span className="font-mono text-[12.5px]">{r.stageData["n-bin"]?.["Bin Number"] || r.binNo || "—"}</span> },
    { label: "Vehicle", render: (r) => r.vehicleNo || "—" },
    { label: "Supplier", render: (r) => r.supplierName || "—" },
    { label: "Warehouse", render: (r) => r.warehouse || "—" },
    { label: "Basis for Bin allocation", render: (r) => r.stageData["n-bin"]?.["Basis for allocation (moisture / quality / KOR / space)"] || "—" },
    { label: "Finalised", render: (r) => r.stageData["n-bin"]?.["Finalised (same day / next day)"] || "—" },
  ];

  return (
    <>
      <PageHeader
        kicker="Procurement"
        title="Lots & Bins"
        lede="Confirmed model: Lot = truck-level traceability, always one truck = one Lot. Bin = physical storage, decided separately and can hold several Lots at once."
      />
      <DataTable columns={columns} rows={withLot} keyFn={(r) => r.id} rowHref={(r) => `/procurement/receipts/${r.id}`} emptyTitle="No Lots or Bins assigned yet" />
    </>
  );
}
