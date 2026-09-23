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
    { label: "Receipt ID", render: (r) => <span className="font-mono text-[12.5px]">{r.id}</span> },
    { label: "Supplier / source", render: (r) => r.stageData["n-delplan"]?.["Supplier / source"] || "—" },
    { label: "Expected qty / truck type", render: (r) => r.stageData["n-delplan"]?.["Expected quantity or truck type"] || "—" },
    { label: "Expected arrival", render: (r) => r.stageData["n-delplan"]?.["Expected arrival date"] || "—" },
    { label: "Destination warehouse", render: (r) => r.stageData["n-delplan"]?.["Destination warehouse"] || "—" },
    { label: "Actual arrival", render: (r) => r.arrivalDate || "not yet arrived" },
  ];

  async function handleNew() {
    // Async now: the id is assigned by the server and we navigate straight to it.
    const id = await createReceipt();
    navigate(`/procurement/receipts/new/${id}/n-delplan`);
  }

  return (
    <>
      <PageHeader
        kicker="Procurement"
        title="Delivery Plans"
        lede="What's expected before a truck arrives, compared against the actual receipt once it's logged."
        actions={
          <button
            onClick={handleNew}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold transition-all shadow-sm"
          >
            <span className="material-symbols-outlined text-[17px]">add</span>
            New delivery plan
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
