import { useState } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { FilterBar } from "../../components/ui/FilterBar";
import { DateRangeInputs, type DateRange } from "../../components/ui/DateRangeInputs";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { FieldHistory } from "../../components/receipt/FieldHistory";
import { useSiteFieldChanges } from "../../state/TrackingContext";
import { useSite, useSwitchSite } from "../../state/SiteContext";

/** The last 30 days, so the page opens on recent work instead of the whole campaign. */
function lastThirtyDays(): DateRange {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

/**
 * Who changed what, on which truck, and when: every field change at this warehouse, newest first (docs/procurement-field-
 * rules.png, "Logs"). Warehouse Incharge sees their own warehouse, an admin any (the server scopes it; Branch Managers and
 * QFS Officers are refused). Nobody can edit or delete a line: the log is only ever written by the save itself.
 */
export function LogsPage() {
  const site = useSite();
  const switchSite = useSwitchSite();
  const [range, setRange] = useState<DateRange>(lastThirtyDays);
  const log = useSiteFieldChanges(site.warehouseName, range.from, range.to);

  return (
    <>
      <PageHeader
        kicker={`${site.label} · ${site.sublabel}`}
        title="Logs"
        lede="Every change to a truck's fields: who made it, when, how, and whether the value broke a rule."
        actions={<SiteSwitcher value={site.slug} onChange={(s) => s && switchSite(s)} />}
      />
      <FilterBar>
        <DateRangeInputs value={range} onChange={setRange} />
      </FilterBar>
      <div className="mt-4">
        <FieldHistory {...log} truckHref={(id) => `/${site.slug}/receipts/${encodeURIComponent(id)}`} />
      </div>
    </>
  );
}
