import { useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { FilterBar } from "../../components/ui/FilterBar";
import { DataTable } from "../../components/ui/DataTable";
import { DateRangeInputs } from "../../components/ui/DateRangeInputs";
import { WorkbookModal } from "../../components/WorkbookModal";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { KpiTile } from "../../components/ui/KpiTile";
import { useTracking, useDownstreamStatus, useReceiptPlanInfo } from "../../state/TrackingContext";
import { useSite, useSwitchSite } from "../../state/SiteContext";
import { useCanEditDirectly } from "../../state/AuthContext";
import { siteSlugForSiteName } from "../../config/sites";
import { deriveStatus, computeDashboardCounts, ALL_STATUSES, STATUS_LABELS } from "../../domain/receiptStatus";
import { receiptColumns, fiche, storeCode } from "./columns";
import { MODULE_STATUSES, type ReceivingModule } from "@anagroci/contract/data/modules";

const icon = (name: string) => <span className="material-symbols-outlined">{name}</span>;

/** Site-scoped Receipts list — one component for both /unit/receipts and /central/receipts (see
 * SiteContext's useSite()). The section itself IS the warehouse filter now, so the old "All
 * warehouses" dropdown is gone; a STORE-level sub-filter takes its place where there's more than
 * one store to choose from (derived from /api/masters' {name,kind,site} shape — a store is any
 * warehouse row whose `site` equals this section's warehouseName). */
export function ReceiptsListPage() {
  const { receipts, masters, refresh } = useTracking();
  const site = useSite();
  const canEdit = useCanEditDirectly();
  const switchSite = useSwitchSite();
  const { status: downstreamStatus, refetch: refetchDownstream } = useDownstreamStatus(site.warehouseName);
  const { info: planInfo } = useReceiptPlanInfo(site.warehouseName, canEdit);
  const [params, setParams] = useSearchParams();
  // Reads an initial ?q= from the global header search so a search there lands here pre-filled.
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const [dialogMode, setDialogMode] = useState<"upload" | "export" | null>(null);
  const navigate = useNavigate();

  // "" = every truck; "reception" / "offloading" = the trucks in that part of receiving (contract data/modules.ts);
  // anything else = that one status. Offloading is a filter here, not a page of its own.
  const status = params.get("status") ?? "";
  const part = status === "reception" || status === "offloading" ? (status as ReceivingModule) : null;
  const base = `/${site.slug}/receipts`;
  const store = params.get("store") ?? "";
  const dateRange = { from: params.get("from") ?? "", to: params.get("to") ?? "" };

  const stores = useMemo(
    // siteSlugForSiteName, not a raw === — a store's `site` column can legitimately hold either
    // the canonical site name or one of its known aliases (see config/sites.ts), so a raw compare
    // would silently drop a real store the moment that column happens to hold the alias value.
    () => masters.warehouses.filter((w) => siteSlugForSiteName(w.site ?? "") === site.slug),
    [masters.warehouses, site.slug]
  );

  const siteReceipts = useMemo(
    () => receipts.filter((r) => r.warehouse === site.warehouseName),
    [receipts, site.warehouseName]
  );

  const counts = useMemo(() => computeDashboardCounts(siteReceipts), [siteReceipts]);

  const rows = useMemo(() => {
    return siteReceipts
      .filter((r) => (part ? MODULE_STATUSES[part].includes(deriveStatus(r)) : !status || status === "all" || deriveStatus(r) === status))
      .filter((r) => !store || storeCode(r) === store)
      .filter((r) => !dateRange.from || r.arrivalDate >= dateRange.from)
      .filter((r) => !dateRange.to || r.arrivalDate <= dateRange.to)
      .filter((r) => {
        if (!q.trim()) return true;
        const needle = q.trim().toLowerCase();
        return (
          r.vehicleNo.toLowerCase().includes(needle) ||
          r.supplierName.toLowerCase().includes(needle) ||
          r.id.toLowerCase().includes(needle) ||
          r.lbaCode.toLowerCase().includes(needle) ||
          (r.lotNo ?? "").toLowerCase().includes(needle) ||
          (r.binNo ?? "").toLowerCase().includes(needle) ||
          storeCode(r).toLowerCase().includes(needle) ||
          fiche(r).toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => (a.arrivalDate < b.arrivalDate ? 1 : -1));
  }, [siteReceipts, status, store, dateRange.from, dateRange.to, q]);

  return (
    <>
      <PageHeader
        kicker={`${site.label} · ${site.sublabel}`}
        title="Reception"
        lede="Every truck from gate entry to GRN. To see only the trucks still being checked, or only the accepted ones being unloaded and recorded, use the status filter (Reception / Offloading)."
        actions={
          <div className="flex items-center gap-3">
            <SiteSwitcher value={site.slug} onChange={(s) => s && switchSite(s)} />
            {/* Direct writes and workbook imports are Warehouse Incharge/admin only; a Branch
                Manager or QFS Officer submits a form from the receipt page instead. */}
            {canEdit && (
              <>
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
                title="Download the ANAGROCI workbook for this warehouse"
              >
                <span className="material-symbols-outlined text-[17px]">download</span>
                Export
              </button>
              {/* The one way to add entries: a grid, whether it's one truck or twenty. */}
              <button
                onClick={() => navigate(`/${site.slug}/receipts/batch`)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold transition-all shadow-sm"
                title="Add one or more entries from a grid"
              >
                <span className="material-symbols-outlined text-[17px]">add</span>
                Add entries
              </button>
              </>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-5">
        <KpiTile icon={icon("local_shipping")} label="Trucks arrived" value={counts.totalReceived} to={base} />
        <KpiTile icon={icon("package_2")} label="Accepted & unloaded" value={counts.acceptedUnloaded} to={`${base}?status=unloaded`} />
        <KpiTile icon={icon("fact_check")} label="GRN completed" value={counts.grnCompleted} to={`${base}?status=grn_completed`} />
        <KpiTile icon={icon("schedule")} label="Pending QA" value={counts.pendingQa} to={`${base}?status=pending_qa`} />
        <KpiTile icon={icon("inventory_2")} label="Pending unload after QA" value={counts.pendingUnload} to={`${base}?status=pending_unload`} />
        <KpiTile icon={icon("cancel")} label="Rejected" value={counts.rejected} to={`${base}?status=rejected`} tone="gap" />
      </div>

      {dialogMode && (
        <WorkbookModal
          mode={dialogMode}
          warehouse={site.warehouseName}
          sectionLabel={`${site.label} · ${site.sublabel}`}
          onClose={() => setDialogMode(null)}
          onCommitted={() => {
            void refresh();
            void refetchDownstream();
          }}
        />
      )}

      <FilterBar>
        <input
          placeholder="Search vehicle, supplier, LBA code, Fiche, Lot, Bin, Store, receipt ID…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full sm:w-64"
        />
        <select value={status} onChange={(e) => setParams((p) => setOrDelete(p, "status", e.target.value))}>
          <option value="">All statuses</option>
          <option value="reception">Reception (gate to quality result)</option>
          <option value="offloading">Offloading (accepted, unload to GRN)</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        {stores.length > 0 && (
          <select value={store} onChange={(e) => setParams((p) => setOrDelete(p, "store", e.target.value))}>
            <option value="">All stores</option>
            {stores.map((w) => (
              <option key={w.name} value={w.name}>
                {w.name}
              </option>
            ))}
          </select>
        )}
        <DateRangeInputs
          value={dateRange}
          onChange={(next) =>
            setParams((p) => setOrDelete(setOrDelete(p, "from", next.from), "to", next.to))
          }
        />
      </FilterBar>

      <DataTable
        columns={receiptColumns(site.slug, downstreamStatus, canEdit ? planInfo : undefined)}
        rows={rows}
        keyFn={(r) => r.id}
        rowHref={(r) => `/${site.slug}/receipts/${r.id}`}
        emptyTitle="No receipts match these filters"
        emptyHint="Clear the search or filters, or add a new RCN receipt."
      />
    </>
  );
}

function setOrDelete(params: URLSearchParams, key: string, value: string) {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  return next;
}
