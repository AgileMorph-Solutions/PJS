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
import { useTracking, useDryingBatches, useDryingSortingReports } from "../../state/TrackingContext";
import { useSite, useSwitchSite } from "../../state/SiteContext";
import type { DryingBatch, DryingSortingReport } from "../../repository/api";
import { deriveStatus } from "../../domain/receiptStatus";

/**
 * Sourced from the two new-sheets drying tables — DryingJob (whose only source,
 * "FINAL DRY RCN-YAKRO-2026", is retired) is no longer read here. Drying Batch is the primary,
 * both-site source; Drying & Sorting Report is a Bouaké-only supplementary detail table (it has no
 * Fiche column at all, so its rows aren't linked to a receipt the way Drying Batch's are).
 */
export function DryingJobsPage() {
  const { receipts } = useTracking();
  const site = useSite();
  const switchSite = useSwitchSite();
  const { batches, refetch: refetchBatches } = useDryingBatches(site.warehouseName);
  const { reports, refetch: refetchReports } = useDryingSortingReports(site.warehouseName);
  const inDrying = useMemo(
    () => receipts.filter((r) => r.warehouse === site.warehouseName && deriveStatus(r) === "in_drying"),
    [receipts, site.warehouseName]
  );
  const inDryingPage = usePagination(inDrying);

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

  const batchColumns: Column<DryingBatch>[] = [
    { label: "Batch ID", render: (b) => <span className="font-mono text-[12.5px]">{b.sn}</span> },
    { label: "Date", render: (b) => b.dryingDate || b.dryingDateRaw || "—" },
    { label: "Warehouse", render: (b) => b.warehouse || b.warehouseSite || "—" },
    { label: "Lot No", render: (b) => b.lotNo || b.lotNoRaw || "—" },
    { label: "Fiche No", render: (b) => b.ficheNoRaw || "—" },
    { label: "Dry type", render: (b) => b.dryType || "—" },
    { label: "Destination", render: (b) => b.destinationRaw || "—" },
    { label: "Status", render: (b) => b.status || "—" },
  ];

  const reportColumns: Column<DryingSortingReport>[] = [
    { label: "S.No.", render: (r) => <span className="font-mono text-[12.5px]">{r.sn ?? "—"}</span> },
    { label: "Date", render: (r) => r.dryingDate || r.dryingDateRaw || "—" },
    { label: "Lot No", render: (r) => r.lotNo || r.lotNoRaw || "—" },
    { label: "Supplier", render: (r) => r.supplierName || "—" },
    { label: "Issued net wt (GRN)", render: (r) => r.issuedNetWeightGrn ?? "—" },
    { label: "Received net wt", render: (r) => r.receivedNetWeightAfterDrying ?? "—" },
    { label: "Input moisture", render: (r) => r.inputMoisture ?? "—" },
    { label: "Output moisture", render: (r) => r.outputMoisture ?? "—" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        kicker={`${site.label} · ${site.sublabel}`}
        title="Drying"
        lede="Drying is tracked per Lot, never per Bin."
        actions={<SiteSwitcher value={site.slug} onChange={(s) => s && switchSite(s)} />}
      />

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
        <h3 className="text-[17px] font-bold text-warmstone-900 mb-2.5">Drying Batch</h3>
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-warmstone-100 text-warmstone-600 text-[11px] font-medium mb-3.5">
          <span className="material-symbols-outlined text-[13px]">description</span>
          ANAGROCI DATA PROCUREMENT 2026.xlsx · Drying Batch
        </span>
        <CollapsibleCard title="Import from workbook">
          <ImportPanel importerId="dryingBatch" onCommitted={() => void refetchBatches()} />
        </CollapsibleCard>
        <div className="mt-3.5">
          <DataTable
            columns={batchColumns}
            rows={batches}
            keyFn={(b) => b.id}
            rowHref={(b) => {
              const receiptId = b.ficheNoRaw ? receiptIdByFiche.get(b.ficheNoRaw.trim()) : undefined;
              return receiptId ? `/${site.slug}/receipts/${receiptId}` : undefined;
            }}
            emptyTitle="No drying batches recorded"
            emptyHint="Import a Drying Batch workbook above to populate this table."
          />
        </div>
      </div>

      <div className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs">
        <h3 className="text-[17px] font-bold text-warmstone-900 mb-2.5">Drying & Sorting Report</h3>
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-warmstone-100 text-warmstone-600 text-[11px] font-medium mb-3.5">
          <span className="material-symbols-outlined text-[13px]">description</span>
          Bouake RCN Drying Report.xlsx · Drying &amp; Sorting Report
        </span>
        <CollapsibleCard title="Import from workbook">
          <ImportPanel importerId="dryingSorting" onCommitted={() => void refetchReports()} />
        </CollapsibleCard>
        <div className="mt-3.5">
          <DataTable
            columns={reportColumns}
            rows={reports}
            keyFn={(r) => r.id}
            emptyTitle="No drying/sorting detail recorded"
            emptyHint="Import a Drying & Sorting Report workbook above to populate this table. Unit (Bouaké) only — this sheet has no central-side rows."
          />
        </div>
      </div>
    </div>
  );
}
