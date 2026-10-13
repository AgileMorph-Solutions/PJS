import { useMemo, useState } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { useDateRangeFilter } from "../../components/ui/useDateRangeFilter";
import { DateRangeInputs } from "../../components/ui/DateRangeInputs";
import { RecordDetailModal } from "../../components/ui/RecordDetailModal";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { useWarehouseDispatches } from "../../state/TrackingContext";
import { useSite, useSwitchSite } from "../../state/SiteContext";
import type { WarehouseDispatchLine } from "../../repository/api";

/**
 * CHARGEMENT — unit-warehouse dispatch OUT, one row per sheet LINE (a voyage may span several
 * lines; see WarehouseDispatchLine's own schema comment). Reachable from Reception's Downstream
 * "Dispatched" chip and a receipt's "Linked records" card, deliberately not a sidebar item — see
 * config/nav.ts's header comment on why Dispatch/Receiving/Issue-to-Production stay out of the
 * Warehouse section now that their data shows on Reception instead.
 */
export function DispatchesPage() {
  const site = useSite();
  const switchSite = useSwitchSite();
  const { lines } = useWarehouseDispatches(site.warehouseName);
  const [detail, setDetail] = useState<WarehouseDispatchLine | null>(null);
  const [status, setStatus] = useState("");
  // Built from what the sheet actually contains, not a hardcoded guess — `status` is free text on
  // the source workbook (see warehouseDispatches.ts: `status: string | null`, no closed set).
  const statusOptions = useMemo(
    () => [...new Set(lines.map((l) => l.status).filter((s): s is string => Boolean(s)))].sort(),
    [lines]
  );

  const columns: Column<WarehouseDispatchLine>[] = [
    { label: "SN", filter: { value: (l) => l.sn, kind: "number" }, render: (l) => <span className="font-mono text-[12.5px]">{l.sn ?? "-"}</span> },
    { label: "Charge date", filter: { value: (l) => l.chargeDate || l.chargeDateRaw, kind: "date" }, render: (l) => l.chargeDate || l.chargeDateRaw || "-" },
    { label: "Voyage no.", filter: { value: (l) => l.vyogeNumber, kind: "text" }, render: (l) => l.vyogeNumber || "-" },
    { label: "Bin", filter: { value: (l) => l.bin }, render: (l) => l.bin || "-" },
    { label: "Truck no.", filter: { value: (l) => l.truckNo, kind: "text" }, render: (l) => l.truckNo || "-" },
    { label: "Fiche CCA", filter: { value: (l) => l.ficheCca, kind: "text" }, render: (l) => <span className="font-mono text-[12.5px]">{l.ficheCca || "-"}</span> },
    { label: "Total bags", filter: { value: (l) => l.totalBags, kind: "number" }, render: (l) => l.totalBags ?? "-" },
    { label: "Status", filter: { value: (l) => l.status }, render: (l) => l.status || "-" },
    {
      label: "",
      render: (l) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setDetail(l); }}
          className="text-[11.5px] font-semibold text-brand-700 hover:text-brand-800 whitespace-nowrap"
        >
          View all fields
        </button>
      ),
    },
  ];

  const dateFilter = useDateRangeFilter(lines, (l) => l.chargeDate);
  const search = useTableSearch(dateFilter.filtered, (l) => [l.vyogeNumber, l.truckNo, l.ficheCca, l.bin]);
  const rows = status ? search.filtered.filter((l) => l.status === status) : search.filtered;

  return (
    <>
      <PageHeader
        kicker={`${site.label} · ${site.sublabel}`}
        title="Dispatches"
        lede="CHARGEMENT - every unit-warehouse dispatch line, one row per sheet line."
        actions={<SiteSwitcher value={site.slug} onChange={(s) => s && switchSite(s)} />}
      />
      <FilterBar>
        <input
          placeholder="Search voyage, truck, Fiche CCA, bin…"
          value={search.q}
          onChange={(e) => search.setQ(e.target.value)}
          className="w-full sm:w-64"
        />
        {statusOptions.length > 0 && (
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <DateRangeInputs value={dateFilter.range} onChange={dateFilter.setRange} />
      </FilterBar>
      <DataTable
        columns={columns}
        rows={rows}
        keyFn={(l) => l.id}
        emptyTitle="No dispatch lines at this site"
        emptyHint="CHARGEMENT is a unit-warehouse (Bouaké) sheet - the central section has none."
      />
      {detail && (
        <RecordDetailModal title={`Dispatch - SN ${detail.sn ?? "-"}`} record={detail} onClose={() => setDetail(null)} />
      )}
    </>
  );
}
