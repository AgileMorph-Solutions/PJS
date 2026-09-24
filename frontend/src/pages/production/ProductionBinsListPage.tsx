import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
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
    { label: "BTMs in", render: (r) => r.btmCount },
    { label: "Lots out", render: (r) => r.lotCount },
    { label: "Source", render: (r) => r.source ?? "—" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Production"
        title="Bins"
        lede="The pivot every BTM lands in and every Lot is created from — a Bin accumulates many BTMs and many Lots, never the reverse."
      />
      {!loading && (
        <DataTable
          columns={columns}
          rows={rows}
          keyFn={(r) => r.binNo}
          rowHref={(r) => `/production/bins/${encodeURIComponent(r.binNo)}`}
          emptyTitle="No production bins observed yet"
          emptyHint="A Bin is auto-observed the first time a BTM or Lot references it."
        />
      )}
    </div>
  );
}
