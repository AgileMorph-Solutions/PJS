import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { WorkbookModal, productionWorkbookClient } from "../../components/WorkbookModal";
import { WorkbookUploadLog } from "../../components/production/WorkbookUploadLog";
import { PageHeader } from "../../components/ui/PageHeader";
import { Button } from "../../components/ui/Button";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { BatchStatusPill, formatTonnes } from "../../components/production/batchUi";
import { useBatches } from "../../state/productionBatches";
import { useProductionPermissions } from "../../state/AuthContext";
import { ProductionFactorySwitcher } from "../../state/productionFactory";
import { BATCH_STATUS_LABELS } from "@anagroci/contract/domain/productionBatch";
import type { BatchSummary } from "@anagroci/contract/types/productionBatch";
import { PRODUCTION_PAGE_SIZE, dateCol, numCol, statusCol, textCol } from "../../components/production/columns";

/**
 * Production's index: every production run at the factory, newest first. A run is the warehouse bins sent to
 * production together; opening one shows its stages (Intake & Calibration, Cooking, ...) and the forms for each.
 * (The data model and the client's documents call it a batch; the screens say "production run" throughout.)
 */
export function ProductionRunsPage() {
  const navigate = useNavigate();
  const { rows, loading, error, refetch } = useBatches();
  const [dialogMode, setDialogMode] = useState<"upload" | "export" | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  // Starting a run is the warehouse's (the bins it sends). Only Admin and the Production Incharge upload the workbook
  // (18 Nov 2026), with no approval after; the Factory Manager may export what they watch and read the upload log.
  const perm = useProductionPermissions();
  const canStart = perm.intake;
  const canUpload = perm.factory;
  const canSeeUploadLog = perm.seeFactory;
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
        lede={perm.seeFactory
          ? "A production run is the warehouse bins sent to the factory floor together. Open one to accept its loads and work every stage after: cooking, shelling and colour sorting."
          : "A production run is the warehouse bins sent to the factory floor together. Open one to record its loads: the moisture check and the weighing. Production accepts each load you finish."}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <ProductionFactorySwitcher />
            {/* Upload / Export, as on Reception: the whole of production up to colour sorting as one workbook. */}
            {canUpload && <Button variant="secondary" icon="upload" onClick={() => setDialogMode("upload")}>Upload</Button>}
            {canSeeUploadLog && <Button variant="secondary" icon="history" onClick={() => setLogOpen(true)} title="Who uploaded which workbook, and when">Upload log</Button>}
            {perm.exportWorkbook && <Button variant="secondary" icon="download" onClick={() => setDialogMode("export")} title="Download every production record, one tab per record type">Export</Button>}
            {canStart && <Button icon="add" onClick={() => navigate("/production/runs/new")}>Start a production run</Button>}
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
      {logOpen && <WorkbookUploadLog onClose={() => setLogOpen(false)} />}
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

