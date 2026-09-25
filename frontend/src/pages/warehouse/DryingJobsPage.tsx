import { useMemo } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { ReceiptStatusPill } from "../../components/ReceiptStatusPill";
import { usePagination } from "../../components/ui/usePagination";
import { Pagination } from "../../components/ui/Pagination";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { ImportPanel } from "../../components/ImportPanel";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { useTracking, useDryingJobs } from "../../state/TrackingContext";
import { useSite, useSwitchSite } from "../../state/SiteContext";
import type { DryingJob } from "../../repository/dryingRepo";
import { deriveStatus } from "../../domain/receiptStatus";

/**
 * Same DryingJob shape at both sites (id/date/warehouse/bin/lotNo/ficheNo/dryType/destination/
 * status — no field differs per warehouse type), so no columns.ts split here either. The real
 * per-site difference is the data itself: today the DryingJob table only holds the 81 rows
 * measured at the central warehouse (see backend note in this repo's step-8 log — the 57 unit rows
 * live only in the newer, not-yet-wired-in `DryingBatch` table) — so /unit/drying honestly renders
 * empty right now rather than fabricating unit rows.
 */
export function DryingJobsPage() {
  const { receipts } = useTracking();
  const site = useSite();
  const switchSite = useSwitchSite();
  // Drying jobs come from the API, deliberately via their own hook rather than TrackingApi —
  // that keeps the TrackingApi interface unchanged by this migration. Scoped server-side via
  // resolveSite(), same as every other site-scoped read.
  const { jobs, refetch } = useDryingJobs(site.warehouseName);
  const inDrying = useMemo(
    () => receipts.filter((r) => r.warehouse === site.warehouseName && deriveStatus(r) === "in_drying"),
    [receipts, site.warehouseName]
  );
  const inDryingPage = usePagination(inDrying);

  // Historical drying jobs can predate today's receipts (imported from the source workbook), so
  // not every job has a matching receipt to link to — rows without a match stay non-clickable.
  //
  // Keyed on FICHE, never on Lot. Lot looks like the obvious key and is wrong: each warehouse runs
  // its own 1..N lot sequence, so the same batch is Lot 17 at the unit warehouse and Lot 20 in this
  // drying report — measured, 345 batches disagree, and the `lot_namespace_disagreement` finding
  // reports it. Matching on lot here would link almost every row to an unrelated receipt that
  // merely shares a small integer. Fiche is the identifier that genuinely survives across sheets.
  const receiptIdByFiche = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of receipts) {
      const fiche = r.stageData["n-verify"]?.["FICHE"]?.trim();
      if (fiche) m.set(fiche, r.id);
    }
    return m;
  }, [receipts]);

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
        kicker={`${site.label} · ${site.sublabel}`}
        title="Drying"
        lede="Drying is tracked per Lot, never per Bin."
        actions={<SiteSwitcher value={site.slug} onChange={(s) => s && switchSite(s)} />}
      />

      <CollapsibleCard title="Import from workbook">
        <ImportPanel importerId="dryingJobs" onCommitted={() => void refetch()} />
      </CollapsibleCard>

      <div className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs">
        <h3 className="text-[17px] font-bold text-warmstone-900 mb-2">Lots currently in drying</h3>
        {inDrying.length === 0 && <p className="text-[13px] text-warmstone-400">None right now.</p>}
        {inDryingPage.pageRows.map((r) => (
          <Link
            key={r.id}
            to={`/${site.slug}/receipts/${r.id}`}
            className="flex items-center justify-between gap-4 py-3 border-b border-warmstone-100 last:border-0 text-[13px] hover:bg-warmstone-50 -mx-1 px-1 rounded-lg transition-colors"
          >
            <span className="text-warmstone-600">
              Lot {r.lotNo || "—"} · Bin {r.binNo || "—"} · {r.supplierName} · vehicle {r.vehicleNo || "—"}
            </span>
            <ReceiptStatusPill status={deriveStatus(r)} />
          </Link>
        ))}
        <Pagination state={inDryingPage} />
      </div>

      <div className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs">
        <h3 className="text-[17px] font-bold text-warmstone-900 mb-2.5">Drying job history</h3>
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-warmstone-100 text-warmstone-600 text-[11px] font-medium mb-3.5">
          <span className="material-symbols-outlined text-[13px]">description</span>
          Drying_Report_Factory_warehouse.xlsx · FINAL DRY RCN-YAKRO-2026
        </span>
        <DataTable
          columns={jobColumns}
          rows={jobs}
          keyFn={(j) => j.id}
          rowHref={(j) => {
            const receiptId = j.ficheNo ? receiptIdByFiche.get(j.ficheNo.trim()) : undefined;
            return receiptId ? `/${site.slug}/receipts/${receiptId}` : undefined;
          }}
          emptyTitle="No drying jobs recorded"
        />
      </div>
    </div>
  );
}
