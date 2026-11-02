import { Link } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { BatchStatusPill, formatTonnes, primaryButton } from "../../components/production/batchUi";
import { useBatches } from "../../state/productionBatches";
import { useCanEditDirectly } from "../../state/AuthContext";
import { BATCH_STATUS_LABELS } from "@anagroci/contract/domain/productionBatch";
import { formatDate } from "@anagroci/contract/domain/dateFormat";
import type { BatchSummary } from "@anagroci/contract/types/productionBatch";

/** Production → Batches: every batch at the factory, newest first. */
export function BatchesListPage() {
  const { rows, loading, error } = useBatches();
  // A QFS Officer reads batches for the moisture checks; creating one is the Incharge's.
  const canCreate = useCanEditDirectly();

  const columns: Column<BatchSummary>[] = [
    { label: "Batch", render: (b) => <span className="font-mono text-[12.5px] font-semibold">{b.code}</span> },
    { label: "Status", filter: { value: (b) => BATCH_STATUS_LABELS[b.status], kind: "select" }, render: (b) => <BatchStatusPill status={b.status} /> },
    { label: "Bins", render: (b) => <span className="font-mono text-[12px]">{b.binCodes.join(", ")}</span> },
    { label: "Planned", align: "right", filter: { value: (b) => b.plannedKg / 1000, kind: "number" }, render: (b) => <span className="tabular-nums">{formatTonnes(b.plannedKg)}</span> },
    { label: "Start", filter: { value: (b) => b.startDate, kind: "date" }, render: (b) => formatDate(b.startDate) },
    { label: "Est. end", render: (b) => (b.endDate ? formatDate(b.endDate) : "-") },
    { label: "Proposed by", render: (b) => b.proposedBy ?? "-" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Production · Batches"
        title="Batches"
        lede="A batch groups the factory's warehouse bins that will be processed together, about one month of work. It is a plan: creating one moves no stock."
        actions={
          canCreate && (
            <Link to="/production/batches/new" className={primaryButton}>
              <span className="material-symbols-outlined text-[18px]">add</span>New batch
            </Link>
          )
        }
      />
      {error && <p className="text-[13px] text-danger-700">{error}</p>}
      {!loading && (
        <DataTable
          columns={columns}
          rows={rows}
          keyFn={(b) => b.code}
          rowHref={(b) => `/production/batches/${encodeURIComponent(b.code)}`}
          emptyTitle="No batches yet"
          emptyHint="Create one from the warehouse bins whose procurement is complete."
        />
      )}
    </div>
  );
}
