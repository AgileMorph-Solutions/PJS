import { useState } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { FilterBar } from "../../components/ui/FilterBar";
import { DateRangeInputs, type DateRange } from "../../components/ui/DateRangeInputs";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { ActivityLog } from "../../components/logs/ActivityLog";
import { useSiteChangeLog, useSiteFieldChanges } from "../../state/TrackingContext";
import { useSite, useSwitchSite } from "../../state/SiteContext";

/** The last 30 days, so the page opens on recent work instead of the whole campaign. */
function lastThirtyDays(): DateRange {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

/**
 * Who changed what, and when: every saved change at this warehouse, newest first (docs/procurement-field-rules.png,
 * "Logs") — a truck's steps, and everything else: transfers, delivery plans, masters, production… Warehouse Incharge sees their own warehouse, an admin any (the server scopes it; Branch Managers and
 * QFS Officers are refused). Nobody can edit or delete a line: the log is only ever written by the save itself.
 */
export function LogsPage() {
  const site = useSite();
  const switchSite = useSwitchSite();
  const [range, setRange] = useState<DateRange>(lastThirtyDays);
  const truck = useSiteFieldChanges(site.warehouseName, range.from, range.to);
  const other = useSiteChangeLog(site.warehouseName, range.from, range.to);

  return (
    <>
      <PageHeader
        kicker={`${site.label} · ${site.sublabel}`}
        title="Logs"
        lede="Every saved change at this warehouse - trucks, transfers, delivery plans, masters, production: who made it, when and how."
        actions={<SiteSwitcher value={site.slug} onChange={(s) => s && switchSite(s)} />}
      />
      <FilterBar>
        <DateRangeInputs value={range} onChange={setRange} />
      </FilterBar>
      <div className="mt-4">
        <ActivityLog truck={truck.changes} other={other.changes} loading={truck.loading || other.loading} error={truck.error ?? other.error} siteSlug={site.slug} />
      </div>
    </>
  );
}
