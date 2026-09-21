import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { StatusPill } from "../../components/ui/StatusPill";
import { useTracking } from "../../state/TrackingContext";
import { loadSeedDryingJobs, type DryingJob } from "../../repository/dryingRepo";
import { deriveStatus } from "../../domain/receiptStatus";

export function DryingJobsPage() {
  const { receipts } = useTracking();
  const jobs = loadSeedDryingJobs();
  const inDrying = receipts.filter((r) => deriveStatus(r) === "in_drying");

  const jobColumns: Column<DryingJob>[] = [
    { label: "Job ID", render: (j) => <span className="mono">{j.id}</span> },
    { label: "Date", render: (j) => j.date || "—" },
    { label: "Warehouse", render: (j) => j.warehouse || "—" },
    { label: "Bin", render: (j) => j.bin || "—" },
    { label: "Lot No", render: (j) => j.lotNo || "—" },
    { label: "Fiche No", render: (j) => j.ficheNo || "—" },
    { label: "Dry type", render: (j) => j.dryType || "—" },
    { label: "Destination", render: (j) => j.destination || "—" },
    { label: "Status", render: (j) => j.status || "—" },
  ];

  return (
    <>
      <PageHeader
        kicker="Procurement"
        title="Drying Jobs"
        lede="Drying is issued and tracked at the specific Lot/quantity level, never as a whole Bin — confirmed by the client. Historical jobs below are real rows from Drying_Report_Factory_warehouse.xlsx."
      />

      <div className="card">
        <h3 style={{ marginBottom: 10 }}>Lots currently in drying</h3>
        <p className="stage-note" style={{ marginBottom: 14 }}>
          Once a truck is assigned a Lot Number, that Lot — not the truck — is what's tracked from
          here on, through its Bin and into drying. The truck/vehicle is kept only as provenance.
        </p>
        {inDrying.length === 0 && <p className="stage-note">None right now.</p>}
        {inDrying.map((r) => (
          <div className="summary-row" key={r.id}>
            <span className="fname">
              Lot {r.lotNo || "—"} · Bin {r.binNo || "—"} · {r.supplierName} · vehicle {r.vehicleNo || "—"}
            </span>
            <StatusPill status={deriveStatus(r)} />
          </div>
        ))}
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 10 }}>Drying job history</h3>
        <div className="file-chip">📄 Drying_Report_Factory_warehouse.xlsx · FINAL DRY RCN-YAKRO-2026</div>
        <DataTable columns={jobColumns} rows={jobs} keyFn={(j) => j.id} emptyTitle="No drying jobs recorded" />
      </div>
    </>
  );
}
