import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { useDateRangeFilter } from "../../components/ui/useDateRangeFilter";
import { DateRangeInputs } from "../../components/ui/DateRangeInputs";
import { ReceiptStatusPill } from "../../components/ReceiptStatusPill";
import { usePagination } from "../../components/ui/usePagination";
import { Pagination } from "../../components/ui/Pagination";
import { ImportModal } from "../../components/ImportModal";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { RecordDetailModal } from "../../components/ui/RecordDetailModal";
import { useTracking, useDryingBatches, useDryingSortingReports } from "../../state/TrackingContext";
import { useSite, useSwitchSite } from "../../state/SiteContext";
import type { DryingBatch, DryingSortingReport } from "../../repository/api";
import { deriveStatus } from "../../domain/receiptStatus";

const DRYING_IMPORTER_IDS = ["dryingBatch", "dryingSorting"];

/** A "View all fields" cell — every DataTable row here may also be a link (rowHref), so this stops
 * the click from bubbling into the row's own navigation. */
function ViewAllFieldsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="text-[11.5px] font-semibold text-brand-700 hover:text-brand-800 whitespace-nowrap"
    >
      View all fields
    </button>
  );
}

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
  const [detailBatch, setDetailBatch] = useState<DryingBatch | null>(null);
  const [detailReport, setDetailReport] = useState<DryingSortingReport | null>(null);
  const [dialogMode, setDialogMode] = useState<"upload" | "export" | null>(null);
  const [tab, setTab] = useState<"batch" | "sorting">("batch");
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
    { label: "", render: (b) => <ViewAllFieldsButton onClick={() => setDetailBatch(b)} /> },
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
    { label: "", render: (r) => <ViewAllFieldsButton onClick={() => setDetailReport(r)} /> },
  ];

  const batchDateFilter = useDateRangeFilter(batches, (b) => b.dryingDate);
  const batchSearch = useTableSearch(batchDateFilter.filtered, (b) => [b.lotNo, b.lotNoRaw, b.ficheNoRaw, String(b.sn), b.warehouse]);
  const reportDateFilter = useDateRangeFilter(reports, (r) => r.dryingDate);
  const reportSearch = useTableSearch(reportDateFilter.filtered, (r) => [r.lotNo, r.lotNoRaw, r.supplierName, r.sn == null ? null : String(r.sn)]);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker={`${site.label} · ${site.sublabel}`}
        title="Drying"
        lede="Drying is tracked per Lot, never per Bin."
        actions={
          <div className="flex items-center gap-3">
            <SiteSwitcher value={site.slug} onChange={(s) => s && switchSite(s)} />
            <button
              onClick={() => setDialogMode("upload")}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-warmstone-200 text-warmstone-700 text-[13px] font-bold hover:bg-warmstone-50 transition-all shadow-xs"
            >
              <span className="material-symbols-outlined text-[17px]">upload</span>
              Upload
            </button>
            <button
              onClick={() => setDialogMode("export")}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-warmstone-200 text-warmstone-700 text-[13px] font-bold hover:bg-warmstone-50 transition-all shadow-xs"
              title="Pick a workbook to export or download a template for"
            >
              <span className="material-symbols-outlined text-[17px]">download</span>
              Export
            </button>
          </div>
        }
      />

      {dialogMode && (
        <ImportModal
          importerIds={DRYING_IMPORTER_IDS}
          siteSlug={site.slug}
          mode={dialogMode}
          onClose={() => setDialogMode(null)}
          onCommitted={() => {
            void refetchBatches();
            void refetchReports();
          }}
        />
      )}

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
        {/* Two genuinely different sheets (different columns, different source workbooks — see
           this file's header comment) tab-switched on one card, not two always-expanded cards
           each with its own duplicated import panel. Local state, not a route: both live at the
           same /:site/drying URL, unlike Jute Bag Management's tabs. */}
        <div className="flex items-center gap-1 border-b border-warmstone-200 mb-4">
          <button
            type="button"
            onClick={() => setTab("batch")}
            className={`px-4 py-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors ${
              tab === "batch" ? "border-brand-700 text-brand-700" : "border-transparent text-warmstone-500 hover:text-warmstone-800"
            }`}
          >
            Drying Batch
          </button>
          <button
            type="button"
            onClick={() => setTab("sorting")}
            className={`px-4 py-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors ${
              tab === "sorting" ? "border-brand-700 text-brand-700" : "border-transparent text-warmstone-500 hover:text-warmstone-800"
            }`}
          >
            Drying &amp; Sorting Report
          </button>
        </div>

        {tab === "batch" ? (
          <>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-warmstone-100 text-warmstone-600 text-[11px] font-medium mb-3.5">
              <span className="material-symbols-outlined text-[13px]">description</span>
              ANAGROCI DATA PROCUREMENT 2026.xlsx · Drying Batch
            </span>
            <FilterBar>
              <input
                placeholder="Search lot, fiche, batch ID…"
                value={batchSearch.q}
                onChange={(e) => batchSearch.setQ(e.target.value)}
                className="w-full sm:w-64"
              />
              <DateRangeInputs value={batchDateFilter.range} onChange={batchDateFilter.setRange} />
            </FilterBar>
            <DataTable
              columns={batchColumns}
              rows={batchSearch.filtered}
              keyFn={(b) => b.id}
              rowHref={(b) => {
                const receiptId = b.ficheNoRaw ? receiptIdByFiche.get(b.ficheNoRaw.trim()) : undefined;
                return receiptId ? `/${site.slug}/receipts/${receiptId}` : undefined;
              }}
              emptyTitle="No drying batches recorded"
              emptyHint="Upload a Drying Batch workbook to populate this table."
            />
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-warmstone-100 text-warmstone-600 text-[11px] font-medium mb-3.5">
              <span className="material-symbols-outlined text-[13px]">description</span>
              Bouake RCN Drying Report.xlsx · Drying &amp; Sorting Report
            </span>
            <FilterBar>
              <input
                placeholder="Search lot, supplier…"
                value={reportSearch.q}
                onChange={(e) => reportSearch.setQ(e.target.value)}
                className="w-full sm:w-64"
              />
              <DateRangeInputs value={reportDateFilter.range} onChange={reportDateFilter.setRange} />
            </FilterBar>
            <DataTable
              columns={reportColumns}
              rows={reportSearch.filtered}
              keyFn={(r) => r.id}
              emptyTitle="No drying/sorting detail recorded"
              emptyHint="Upload a Drying & Sorting Report workbook to populate this table. Unit (Bouaké) only — this sheet has no central-side rows."
            />
          </>
        )}
      </div>

      {detailBatch && (
        <RecordDetailModal
          title={`Drying Batch — SN ${detailBatch.sn}`}
          record={detailBatch}
          onClose={() => setDetailBatch(null)}
        />
      )}
      {detailReport && (
        <RecordDetailModal
          title={`Drying & Sorting Report — S.No. ${detailReport.sn ?? "—"}`}
          record={detailReport}
          onClose={() => setDetailReport(null)}
        />
      )}
    </div>
  );
}
