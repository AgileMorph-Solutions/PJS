import { useMemo, useState } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { useDateRangeFilter } from "../../components/ui/useDateRangeFilter";
import { DateRangeInputs } from "../../components/ui/DateRangeInputs";
import { RecordDetailModal } from "../../components/ui/RecordDetailModal";
import { useIssuedToProduction } from "../../state/TrackingContext";
import type { IssuedToProductionRow } from "../../repository/api";

/**
 * Factory Warehouse RCN Transfer to Production Report — no site column on this table at all (it's
 * logically central/Yakro-Factory-side data, but the sheet itself carries no site cell to scope
 * by, so this page is NOT under `/:site/*`). Reachable from a receipt's "Linked records" card
 * (via the transfer -> BtmIntake -> IssuedToProduction hop) and Reception's Downstream "Issued"
 * chip — deliberately not a sidebar item, same reasoning as DispatchesPage.
 */
export function IssuedToProductionPage() {
  const { rows } = useIssuedToProduction();
  const [detail, setDetail] = useState<IssuedToProductionRow | null>(null);
  const [binStatus, setBinStatus] = useState("");
  // Built from the sheet's own values, not a hardcoded guess — binStatus is free text on the
  // source workbook, no closed enum defined for it.
  const binStatusOptions = useMemo(
    () => [...new Set(rows.map((r) => r.binStatus).filter((s): s is string => Boolean(s)))].sort(),
    [rows]
  );

  const columns: Column<IssuedToProductionRow>[] = [
    { label: "BTM No.", render: (r) => <span className="font-mono text-[12.5px]">{r.btmNo || "-"}</span> },
    { label: "Date", filter: { value: (r) => r.date, kind: "date" }, render: (r) => r.date || "-" },
    { label: "Source Bin", filter: { value: (r) => r.sourceBin }, render: (r) => r.sourceBin || "-" },
    { label: "Dry Bin", filter: { value: (r) => r.dryBin }, render: (r) => r.dryBin || "-" },
    { label: "Bin Status", filter: { value: (r) => r.binStatus }, render: (r) => r.binStatus || "-" },
    { label: "Bags issued", filter: { value: (r) => r.noOfBagIssuedToProduction, kind: "number" }, render: (r) => r.noOfBagIssuedToProduction || "-" },
    { label: "Moisture", filter: { value: (r) => r.moisture, kind: "number" }, render: (r) => r.moisture || "-" },
    {
      label: "",
      render: (r) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setDetail(r); }}
          className="text-[11.5px] font-semibold text-brand-700 hover:text-brand-800 whitespace-nowrap"
        >
          View all fields
        </button>
      ),
    },
  ];

  const dateFilter = useDateRangeFilter(rows, (r) => r.date);
  const search = useTableSearch(dateFilter.filtered, (r) => [r.btmNo, r.sourceBin, r.dryBin]);
  const filteredRows = binStatus ? search.filtered.filter((r) => r.binStatus === binStatus) : search.filtered;

  return (
    <>
      <PageHeader
        title="Issued to Production"
        lede="Every RCN batch issued from a dry bin into production, from the Factory Warehouse RCN Transfer to Production Report."
      />
      <FilterBar>
        <input
          placeholder="Search BTM No, source bin, dry bin…"
          value={search.q}
          onChange={(e) => search.setQ(e.target.value)}
          className="w-full sm:w-64"
        />
        {binStatusOptions.length > 0 && (
          <select value={binStatus} onChange={(e) => setBinStatus(e.target.value)}>
            <option value="">All bin statuses</option>
            {binStatusOptions.map((s) => (
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
        rows={filteredRows}
        keyFn={(r) => r.id}
        emptyTitle="Nothing issued to production yet"
      />
      {detail && (
        <RecordDetailModal title={`Issued to Production - BTM ${detail.btmNo || "-"}`} record={detail} onClose={() => setDetail(null)} />
      )}
    </>
  );
}
