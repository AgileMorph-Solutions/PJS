import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { WorkbookModal, productionWorkbookClient } from "../../components/WorkbookModal";
import { PageHeader } from "../../components/ui/PageHeader";
import { Button } from "../../components/ui/Button";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { BatchStatusPill, formatTonnes } from "../../components/production/batchUi";
import { useBatches } from "../../state/productionBatches";
import { useCanEditDirectly } from "../../state/AuthContext";
import { ProductionFactorySwitcher } from "../../state/productionFactory";
import { BATCH_STATUS_LABELS } from "@anagroci/contract/domain/productionBatch";
import type { BatchSummary } from "@anagroci/contract/types/productionBatch";
import { PRODUCTION_PAGE_SIZE, dateCol, numCol, statusCol, textCol } from "../../components/production/columns";

/**
 * Production's index: every production run at the factory, newest first. A run is the warehouse bins sent to
 * production together; opening one shows its stages (Intake, Calibration, Cooking, ...) and the forms for each.
 * (The data model and the client's documents call it a batch; the screens say "production run" throughout.)
 */
export function ProductionRunsPage() {
  const navigate = useNavigate();
  const { rows, loading, error, refetch } = useBatches();
  const [dialogMode, setDialogMode] = useState<"upload" | "export" | null>(null);
  // A QFS Officer opens runs for their quality checks; starting one is the Incharge's.
  const canStart = useCanEditDirectly();
  const search = useTableSearch(rows, (r) => [r.code, r.name, ...r.binCodes]);

  const columns: Column<BatchSummary>[] = [
    textCol("Production run ID", (r) => r.code, { mono: true, strong: true }),
    // A run uploaded from a workbook may carry the team's own name for it (ANA-03B); one started here has only its ID.
    textCol("Name", (r) => r.name),
    statusCol("Status", (r) => BATCH_STATUS_LABELS[r.status], (r) => <BatchStatusPill status={r.status} />),
    { ...textCol<BatchSummary>("Warehouse bins", (r) => r.binCodes.join(", "), { mono: true, wrap: true }) },
    // Filtered in tonnes, as it reads.
    { ...numCol<BatchSummary>("RCN planned (t)", (r) => r.plannedKg / 1000, { digits: 1 }), render: (r) => formatTonnes(r.plannedKg) },
    dateCol("Started", (r) => r.startDate),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Production"
        title="Production runs"
        lede="A production run is the warehouse bins sent to the factory floor together. Open one to record its loads and every stage after: calibration, cooking, shelling and colour sorting."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <ProductionFactorySwitcher />
            {canStart && (
              <>
                {/* Upload / Export, as on Reception: the whole of production up to colour sorting as one workbook. */}
                <Button variant="secondary" icon="upload" onClick={() => setDialogMode("upload")}>Upload</Button>
                <Button variant="secondary" icon="download" onClick={() => setDialogMode("export")} title="Download every production record, one tab per record type">Export</Button>
                <Button icon="add" onClick={() => navigate("/production/runs/new")}>Start a production run</Button>
              </>
            )}
          </div>
        }
      />
      {dialogMode && (
        <WorkbookModal
          mode={dialogMode}
          warehouse=""
          sectionLabel="Production"
          client={productionWorkbookClient}
          onClose={() => setDialogMode(null)}
          onCommitted={() => void refetch()}
        />
      )}
      <FilterBar>
        <input placeholder="Search run ID, name or bin…" value={search.q} onChange={(e) => search.setQ(e.target.value)} className="w-full sm:w-72" />
      </FilterBar>
      {error && <p role="alert" className="text-[13px] text-danger-700">{error}</p>}
      {!loading && (
        <DataTable pageSize={PRODUCTION_PAGE_SIZE}
          columns={columns}
          rows={search.filtered}
          keyFn={(r) => r.code}
          rowHref={(r) => `/production/runs/${encodeURIComponent(r.code)}`}
          emptyTitle="No production run yet"
          emptyHint={canStart ? "Start one by picking the warehouse bins that go to production." : "The Warehouse Incharge starts a run from the warehouse bins."}
        />
      )}
    </div>
  );
}

