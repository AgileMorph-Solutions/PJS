import { useNavigate } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { useTracking } from "../../state/TrackingContext";
import type { ReceiptRecord } from "../../types/receipt";

export function DeliveryPlansPage() {
  const { receipts, createReceipt } = useTracking();
  const navigate = useNavigate();
  const planned = receipts.filter((r) => r.stageData["n-delplan"]);

  const columns: Column<ReceiptRecord>[] = [
    { label: "Receipt ID", render: (r) => <span className="mono">{r.id}</span> },
    { label: "Supplier / source", render: (r) => r.stageData["n-delplan"]?.["Supplier / source"] || "—" },
    { label: "Expected qty / truck type", render: (r) => r.stageData["n-delplan"]?.["Expected quantity or truck type"] || "—" },
    { label: "Expected arrival", render: (r) => r.stageData["n-delplan"]?.["Expected arrival date"] || "—" },
    { label: "Destination warehouse", render: (r) => r.stageData["n-delplan"]?.["Destination warehouse"] || "—" },
    { label: "Actual arrival", render: (r) => r.arrivalDate || "not yet arrived" },
  ];

  function handleNew() {
    const id = createReceipt();
    navigate(`/procurement/receipts/new/${id}/n-delplan`);
  }

  return (
    <>
      <PageHeader
        kicker="Procurement"
        title="Delivery Plans"
        lede="What's expected before a truck arrives (doc §2) — supplier/source, expected quantity, expected date, destination warehouse. Compared against actual arrival once the receipt is logged."
        actions={
          <button className="btn btn-primary" onClick={handleNew}>
            + New delivery plan
          </button>
        }
      />
      <DataTable
        columns={columns}
        rows={planned}
        keyFn={(r) => r.id}
        rowHref={(r) => `/procurement/receipts/${r.id}`}
        emptyTitle="No delivery plans yet"
        emptyHint="Add one to capture what's expected before the truck shows up at the gate."
      />
    </>
  );
}
