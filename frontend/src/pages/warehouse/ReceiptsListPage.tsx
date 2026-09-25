import { useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { FilterBar } from "../../components/ui/FilterBar";
import { DataTable } from "../../components/ui/DataTable";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { ImportPanel } from "../../components/ImportPanel";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { KpiTile } from "../../components/ui/KpiTile";
import { useTracking } from "../../state/TrackingContext";
import { useSite, useSwitchSite } from "../../state/SiteContext";
import { siteSlugForSiteName } from "../../config/sites";
import { deriveStatus, computeDashboardCounts, ALL_STATUSES, STATUS_LABELS } from "../../domain/receiptStatus";
import { stages } from "../../data/stages";
import { RECEIPT_COLUMNS, fiche, storeCode } from "./columns";

const icon = (name: string) => <span className="material-symbols-outlined">{name}</span>;

/** Site-scoped Receipts list — one component for both /unit/receipts and /central/receipts (see
 * SiteContext's useSite()). The section itself IS the warehouse filter now, so the old "All
 * warehouses" dropdown is gone; a STORE-level sub-filter takes its place where there's more than
 * one store to choose from (derived from /api/masters' {name,kind,site} shape — a store is any
 * warehouse row whose `site` equals this section's warehouseName). */
export function ReceiptsListPage() {
  const { receipts, masters, createReceipt, refresh } = useTracking();
  const site = useSite();
  const switchSite = useSwitchSite();
  const [params, setParams] = useSearchParams();
  // Reads an initial ?q= from the global header search so a search there lands here pre-filled.
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const navigate = useNavigate();

  const status = params.get("status") ?? "";
  const store = params.get("store") ?? "";

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
      .filter((r) => !status || deriveStatus(r) === status)
      .filter((r) => !store || storeCode(r) === store)
      .filter((r) => {
        if (!q.trim()) return true;
        const needle = q.trim().toLowerCase();
        return (
          r.vehicleNo.toLowerCase().includes(needle) ||
          r.supplierName.toLowerCase().includes(needle) ||
          r.id.toLowerCase().includes(needle) ||
          r.lbaCode.toLowerCase().includes(needle) ||
          (r.lotNo ?? "").toLowerCase().includes(needle) ||
          fiche(r).toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => (a.arrivalDate < b.arrivalDate ? 1 : -1));
  }, [siteReceipts, status, store, q]);

  async function handleNewReceipt() {
    // Async: the id is assigned by the server, and scoped to this section's own site so a truck
    // created from /unit or /central lands at the right warehouse from the start.
    const id = await createReceipt(site.warehouseName);
    navigate(`/${site.slug}/receipts/new/${id}/${stages[0].id}`);
  }

  return (
    <>
      <PageHeader
        kicker={`${site.label} · ${site.sublabel}`}
        title="Truck Reception"
        lede="Every RCN receipt at this site — open one to fill in or review its stages."
        actions={
          <div className="flex items-center gap-3">
            <SiteSwitcher value={site.slug} onChange={(s) => s && switchSite(s)} />
            <button
              onClick={handleNewReceipt}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold transition-all shadow-sm"
            >
              <span className="material-symbols-outlined text-[17px]">add</span>
              New RCN receipt
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-5">
        <KpiTile icon={icon("local_shipping")} label="Total received" value={counts.totalReceived} to={`/${site.slug}/receipts`} />
        <KpiTile icon={icon("package_2")} label="Accepted & unloaded" value={counts.acceptedUnloaded} to={`/${site.slug}/receipts?status=unloaded`} />
        <KpiTile icon={icon("fact_check")} label="GRN completed" value={counts.grnCompleted} to={`/${site.slug}/receipts?status=grn_completed`} />
        <KpiTile icon={icon("schedule")} label="Pending QA" value={counts.pendingQa} to={`/${site.slug}/receipts?status=pending_qa`} />
        <KpiTile icon={icon("inventory_2")} label="Pending unload after QA" value={counts.pendingUnload} to={`/${site.slug}/receipts?status=pending_unload`} />
        <KpiTile icon={icon("cancel")} label="Rejected" value={counts.rejected} to={`/${site.slug}/receipts?status=rejected`} tone="gap" />
      </div>

      <div className="mb-5">
        <CollapsibleCard title="Import from workbook">
          <ImportPanel importerId="truckReception" onCommitted={() => void refresh()} />
        </CollapsibleCard>
      </div>

      <FilterBar>
        <input
          placeholder="Search vehicle, supplier, LBA code, Fiche, Lot, receipt ID…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full sm:w-64"
        />
        <select value={status} onChange={(e) => setParams((p) => setOrDelete(p, "status", e.target.value))}>
          <option value="">All statuses</option>
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
      </FilterBar>

      <DataTable
        columns={RECEIPT_COLUMNS[site.slug]}
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
