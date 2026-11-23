import { useState } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { Pill } from "../../components/ui/Pill";
import { useTracking } from "../../state/TrackingContext";
import { useSite, useSwitchSite } from "../../state/SiteContext";
import { useSiteBins } from "../../state/useBins";
import type { SiteBinSummary } from "../../repository/api";
import { siteTypeOf } from "@anagroci/contract/domain/siteType";

/**
 * Warehouse activities — the warehouse's Bins. Once reception has put RCN in a Bin the Lots in it can't be told apart (Sameer,
 * 18 Nov 2026: "once the bin is created, lot is gone"), so what happens inside the warehouse is the Bin's: sun drying, the labour
 * activities (re-bagging, destacking, triage, moves), and the last step — a transfer to the Central warehouse from a Unit one,
 * production at a Central one. Every Bin of the warehouse is listed, empty ones too; opening one goes to its page.
 */
export function WarehouseActivitiesPage() {
  const site = useSite();
  const switchSite = useSwitchSite();
  const { masters } = useTracking();
  // This warehouse's own Bins, or — to find and fix them — the Bins of the master with no warehouse (23 Nov 2026).
  const [unassigned, setUnassigned] = useState(false);
  const { bins, loading, error } = useSiteBins(site.warehouseName, true, unassigned);
  const search = useTableSearch(bins, (b) => [b.binCode, b.store]);
  const central = siteTypeOf(masters.warehouses, masters.aliases, site.warehouseName) === "CENTRAL";

  const columns: Column<SiteBinSummary>[] = [
    { label: "Bin", nowrap: true, render: (b) => <span className="font-medium text-warmstone-900">{b.binCode}</span> },
    {
      label: "Warehouse",
      filter: { value: (b) => b.store },
      nowrap: true,
      render: (b) => (b.store ? b.store : <Pill tone="gap" label="No warehouse" />),
    },
    {
      label: "Lots",
      align: "right",
      nowrap: true,
      filter: { value: (b) => b.lotCount, kind: "number" },
      render: (b) => <span className="tabular-nums">{b.lotCount}{b.lotsWithoutKg ? <span className="text-warmstone-500"> ({b.lotsWithoutKg} without kg)</span> : null}</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        kicker={`${site.label} · ${site.sublabel}`}
        title="Warehouse activities"
        lede={`What happens inside the warehouse is recorded on the Bin: once RCN is in a Bin, its Lots can't be told apart. Open a Bin to record sun drying, re-bagging, destacking, triage or a move, and to ${central ? "send it to production" : "send it on a transfer"}.`}
        actions={<SiteSwitcher value={site.slug} onChange={(s) => s && switchSite(s)} />}
      />
      {error && <p role="alert" className="px-1 text-[13px] text-danger-700">{error}</p>}
      <FilterBar>
        <input placeholder="Search a Bin or warehouse…" value={search.q} onChange={(e) => search.setQ(e.target.value)} className="w-full sm:w-64" />
        <select aria-label="Show" value={unassigned ? "none" : "mine"} onChange={(e) => setUnassigned(e.target.value === "none")} className="w-full sm:w-56">
          <option value="mine">This warehouse's Bins</option>
          <option value="none">Bins with no warehouse</option>
        </select>
      </FilterBar>
      <DataTable
        columns={columns}
        rows={search.filtered}
        keyFn={(b) => b.binCode}
        rowHref={(b) => `/${site.slug}/warehouse-activities/${encodeURIComponent(b.binCode)}`}
        emptyTitle={loading ? "Loading Bins…" : unassigned ? "Every Bin has a warehouse" : "No Bins at this warehouse yet"}
        emptyHint={loading ? undefined : unassigned ? undefined : "Bins are added in Masters › Bins. RCN is in a Bin once reception's GRN is complete."}
      />
    </div>
  );
}
