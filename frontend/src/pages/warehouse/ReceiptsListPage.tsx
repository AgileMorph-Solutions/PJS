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
import { NO_STORE, useReceptionStore, useSite, useSwitchSite } from "../../state/SiteContext";
import { receiptStore } from "@anagroci/contract/domain/siteType";
import { useCanEditDirectly } from "../../state/AuthContext";
import { deriveStatus, computeDashboardCounts, ALL_STATUSES, STATUS_LABELS } from "../../domain/receiptStatus";
import { receiptColumns, fiche, storeCode } from "./columns";
import { MODULE_STATUSES, type ReceivingModule } from "@anagroci/contract/data/modules";

const icon = (name: string) => <span className="material-symbols-outlined">{name}</span>;

/** Reception for ONE STORE (BKE-001) — the warehouse the trucks actually come into. The site above it (BOUAKE) is
 * only the group the store sits in: it picks the URL's `/<site>/` section, and the switcher lists each site's stores
 * under it. Which store a truck is at is contract's receiptStore; trucks the site holds at no store get a view of
 * their own ("No store") rather than disappearing from every store's list. A site with no store yet shows its own. */
export function ReceiptsListPage() {
  const { receipts, masters, refresh } = useTracking();
  const site = useSite();
  const canEdit = useCanEditDirectly();
  const switchSite = useSwitchSite();
  const { store, isNoStore } = useReceptionStore();
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
  const dateRange = { from: params.get("from") ?? "", to: params.get("to") ?? "" };

  // Every truck of this site — filed at the site, an alias of it, or one of its stores — with the store it is at.
  const siteReceipts = useMemo(() => {
    const names = new Set([site.warehouseName, ...site.aliases, ...site.stores]);
    return receipts
      .filter((r) => names.has(r.warehouse))
      .map((r) => ({ r, at: receiptStore(masters.warehouses, masters.aliases, r) }));
  }, [receipts, site, masters.warehouses, masters.aliases]);

  const noStoreCount = useMemo(() => (site.stores.length ? siteReceipts.filter((x) => !x.at).length : 0), [siteReceipts, site.stores.length]);

  // With no store in the master the site is the one place, so every truck is shown.
  const storeReceipts = useMemo(
    () => siteReceipts.filter((x) => !site.stores.length || (isNoStore ? !x.at : x.at === store)).map((x) => x.r),
    [siteReceipts, site.stores.length, isNoStore, store]
  );

  const counts = useMemo(() => computeDashboardCounts(storeReceipts), [storeReceipts]);
  const place = isNoStore ? "No warehouse" : store || site.sublabel;
  const pickStore = (st: string) => setParams((p) => setOrDelete(p, "store", st));
  // The KPI tiles keep the store being looked at; dropping it would land on the default store instead.
  const tile = (st?: string) => {
    const q = new URLSearchParams();
    if (params.get("store")) q.set("store", params.get("store")!);
    if (st) q.set("status", st);
    return q.size ? `${base}?${q}` : base;
  };

  const rows = useMemo(() => {
    return storeReceipts
      .filter((r) => (part ? MODULE_STATUSES[part].includes(deriveStatus(r)) : !status || status === "all" || deriveStatus(r) === status))
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
  }, [storeReceipts, part, status, dateRange.from, dateRange.to, q]);

  return (
    <>
      <PageHeader
        kicker={`${site.label} · ${site.sublabel}`}
        title={`Reception · ${place}`}
        lede="Every truck from gate entry to GRN. To see only the trucks still being checked, or only the accepted ones being unloaded and recorded, use the status filter (Reception / Offloading)."
        actions={
          <div className="flex items-center gap-3">
            <SiteSwitcher
              value={site.slug}
              onChange={(s) => s && switchSite(s, { store: null })}
              store={store}
              onPickStore={(s, st) => (s === site.slug ? pickStore(st) : switchSite(s, { store: st || null }))}
              extraOption={noStoreCount ? { store: NO_STORE, label: `No warehouse (${noStoreCount})` } : undefined}
            />
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
                onClick={() => navigate(`/${site.slug}/receipts/batch${store && !isNoStore ? `?store=${encodeURIComponent(store)}` : ""}`)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold transition-all shadow-sm"
                title={`Add one or more entries at ${isNoStore ? "a warehouse" : place}, from a grid`}
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
        <KpiTile icon={icon("local_shipping")} label="Trucks arrived" value={counts.totalReceived} to={tile()} />
        <KpiTile icon={icon("package_2")} label="Accepted & unloaded" value={counts.acceptedUnloaded} to={tile("unloaded")} />
        <KpiTile icon={icon("fact_check")} label="GRN completed" value={counts.grnCompleted} to={tile("grn_completed")} />
        <KpiTile icon={icon("schedule")} label="Pending QA" value={counts.pendingQa} to={tile("pending_qa")} />
        <KpiTile icon={icon("inventory_2")} label="Pending unload after QA" value={counts.pendingUnload} to={tile("pending_unload")} />
        <KpiTile icon={icon("cancel")} label="Rejected" value={counts.rejected} to={tile("rejected")} tone="gap" />
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
          placeholder="Search vehicle, supplier, LBA code, Fiche, Lot, Bin, WH NO., receipt ID…"
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
        {/* Someone with only their own store has no switcher above, so the way to the site's no-store trucks is here. */}
        {noStoreCount > 0 && (
          <button
            type="button"
            onClick={() => pickStore(isNoStore ? "" : NO_STORE)}
            className="text-[12px] font-semibold text-brand-700 hover:text-brand-800"
          >
            {isNoStore ? "Back to the warehouse's trucks" : `${noStoreCount} ${noStoreCount === 1 ? "truck" : "trucks"} in ${site.sublabel} with no warehouse`}
          </button>
        )}
        <DateRangeInputs
          value={dateRange}
          onChange={(next) =>
            setParams((p) => setOrDelete(setOrDelete(p, "from", next.from), "to", next.to))
          }
        />
      </FilterBar>

      <DataTable
        columns={receiptColumns(isNoStore, downstreamStatus, canEdit ? planInfo : undefined)}
        rows={rows}
        keyFn={(r) => r.id}
        rowHref={(r) => `/${site.slug}/receipts/${r.id}`}
        emptyTitle="No receipts match these filters"
        emptyHint={`Clear the search or filters, or add a new RCN receipt at ${isNoStore ? "a warehouse" : place}.`}
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
