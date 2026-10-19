import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { useProductionBins } from "../../state/TrackingContext";
import type { ProductionBinSummary } from "../../repository/api";

/** The pivot view: every production Bin, with how many BTMs fed it and how many Lots came out of
 * it. A Bin holds many BTMs and many Lots, never the reverse (confirmed rule) — this list is the
 * production twin of Masters > Bins, but scoped to production's own ANA-x/BIN-0xx namespace
 * (deliberately not merged with procurement's Bin master — see ProductionBin's schema comment). */
export function ProductionBinsListPage() {
  const { rows, loading } = useProductionBins();

  const columns: Column<ProductionBinSummary>[] = [
    { label: "Bin No", render: (r) => <span className="font-mono text-[12.5px] font-semibold">{r.binNo}</span> },
    { label: "BTMs in", filter: { value: (r) => r.btmCount, kind: "number" }, render: (r) => r.btmCount },
    { label: "Lots out", filter: { value: (r) => r.lotCount, kind: "number" }, render: (r) => r.lotCount },
    { label: "Source", filter: { value: (r) => r.source }, render: (r) => r.source ?? "-" },
  ];

  const search = useTableSearch(rows, (r) => [r.binNo, r.source]);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Production"
        title="Bins"
        lede="The pivot every BTM lands in and every Lot is created from - a Bin accumulates many BTMs and many Lots, never the reverse."
      />
      {!loading && (
        <>
          <FilterBar>
            <input
              placeholder="Search Bin No, source…"
              value={search.q}
              onChange={(e) => search.setQ(e.target.value)}
              className="w-full sm:w-64"
            />
          </FilterBar>
          <DataTable
            columns={columns}
            rows={search.filtered}
            keyFn={(r) => r.binNo}
            rowHref={(r) => `/production/bins/${encodeURIComponent(r.binNo)}`}
            emptyTitle="No production bins observed yet"
            emptyHint="A Bin is auto-observed the first time a BTM or Lot references it."
          />
        </>
      )}
    </div>
  );
}
