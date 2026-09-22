import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { ReceiptStatusPill } from "../../components/ReceiptStatusPill";
import { useTracking, useDryingJobs } from "../../state/TrackingContext";
import type { DryingJob } from "../../repository/dryingRepo";
import { deriveStatus } from "../../domain/receiptStatus";

export function DryingJobsPage() {
  const { receipts } = useTracking();
  // Drying jobs come from the API, deliberately via their own hook rather than TrackingApi —
  // that keeps the TrackingApi interface unchanged by this migration.
  const { jobs } = useDryingJobs();
  const inDrying = receipts.filter((r) => deriveStatus(r) === "in_drying");

  const jobColumns: Column<DryingJob>[] = [
    { label: "Job ID", render: (j) => <span className="font-mono text-[12.5px]">{j.id}</span> },
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
    <div className="space-y-5">
      <PageHeader
        kicker="Procurement"
        title="Drying Jobs"
        lede="Drying is issued and tracked at the specific Lot/quantity level, never as a whole Bin — confirmed by the client. Historical jobs below are real rows from Drying_Report_Factory_warehouse.xlsx."
      />

      <div className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs">
        <h3 className="text-[17px] font-bold text-warmstone-900 mb-2">Lots currently in drying</h3>
        <p className="text-[13px] text-warmstone-500 leading-relaxed mb-3.5">
          Once a truck is assigned a Lot Number, that Lot — not the truck — is what's tracked from here on, through its Bin and into
          drying. The truck/vehicle is kept only as provenance.
        </p>
        {inDrying.length === 0 && <p className="text-[13px] text-warmstone-400">None right now.</p>}
        {inDrying.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-4 py-3 border-b border-warmstone-100 last:border-0 text-[13px]">
            <span className="text-warmstone-600">
              Lot {r.lotNo || "—"} · Bin {r.binNo || "—"} · {r.supplierName} · vehicle {r.vehicleNo || "—"}
            </span>
            <ReceiptStatusPill status={deriveStatus(r)} />
          </div>
        ))}
      </div>

      <div className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs">
        <h3 className="text-[17px] font-bold text-warmstone-900 mb-2.5">Drying job history</h3>
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-warmstone-100 text-warmstone-600 text-[11px] font-medium mb-3.5">
          <span className="material-symbols-outlined text-[13px]">description</span>
          Drying_Report_Factory_warehouse.xlsx · FINAL DRY RCN-YAKRO-2026
        </span>
        <DataTable columns={jobColumns} rows={jobs} keyFn={(j) => j.id} emptyTitle="No drying jobs recorded" />
      </div>
    </div>
  );
}
