import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { ImportPanel } from "../../components/ImportPanel";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { useSite, useSwitchSite } from "../../state/SiteContext";
import { useBtmIntakes } from "../../state/TrackingContext";
import type { BtmIntake } from "../../repository/api";

/**
 * Central-only page for the "Issued to Production Section" workbook (125 rows / 112 BTMs — see
 * packages/contract/src/data/productionTables.ts's "issued-to-production" table). No new backend
 * endpoint was added for this: that table is already reachable per-BTM via the existing generic
 * `GET /api/production/btm/:btmNo/tables/issued-to-production` route, and BtmDetailPage's accordion
 * (frontend/src/pages/production/BtmDetailPage.tsx) already renders it as one of every BTM's
 * spine tables — see BTM_SPINE_TABLES in productionStatus.ts, which includes it automatically.
 *
 * So this page is the list-and-link half: every BTM (useBtmIntakes(), same hook BtmListPage uses —
 * production has no site column, since it's central-only by construction), linking into the
 * existing per-BTM record where "Issued to production" is one of the accordion steps, fully able
 * to view and add rows already. Building a second, parallel table+form here would duplicate that
 * exact capability for no benefit — the judgment call this page makes is "point at what already
 * works", not "add a bulk list endpoint that doesn't exist yet" (btmNo is a soft reference — 8-9 of
 * 112 BTMs referenced in the source sheet have no BtmIntake row at all, and are reported, not
 * auto-created, so they don't appear in this list either — see Data Quality for that gap).
 */
export function RcnIssueToProductionPage() {
  const site = useSite();
  const switchSite = useSwitchSite();
  const { rows, refetch } = useBtmIntakes();

  const columns: Column<BtmIntake>[] = [
    { label: "BTM No", render: (r) => <span className="font-mono text-[12.5px] font-semibold">{r.btmNo}</span> },
    { label: "Destination Bin", render: (r) => r.binNo },
    { label: "Source", render: (r) => r.source ?? "—" },
    { label: "Recorded", render: (r) => new Date(r.createdAt).toLocaleDateString() },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        kicker={`${site.label} · ${site.sublabel}`}
        title="Issue to Production"
        lede="Dry RCN handed from the central warehouse to a BTM — open a BTM below to view or add its Issued to Production rows."
        actions={<SiteSwitcher value={site.slug} onChange={(s) => s && switchSite(s)} />}
      />

      <CollapsibleCard title="Import from workbook">
        <ImportPanel importerId="issuedToProduction" onCommitted={() => void refetch()} />
      </CollapsibleCard>

      <DataTable
        columns={columns}
        rows={rows}
        keyFn={(r) => r.btmNo}
        rowHref={(r) => `/production/btm/${encodeURIComponent(r.btmNo)}`}
        emptyTitle="No BTMs recorded yet"
        emptyHint="Import an Issued to Production workbook above, or record a BTM from the Production section."
      />
    </div>
  );
}
