import { useState } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
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

  const columns: Column<IssuedToProductionRow>[] = [
    { label: "BTM No.", render: (r) => <span className="font-mono text-[12.5px]">{r.btmNo || "—"}</span> },
    { label: "Date", render: (r) => r.date || "—" },
    { label: "Source Bin", render: (r) => r.sourceBin || "—" },
    { label: "Dry Bin", render: (r) => r.dryBin || "—" },
    { label: "Bin Status", render: (r) => r.binStatus || "—" },
    { label: "Bags issued", render: (r) => r.noOfBagIssuedToProduction || "—" },
    { label: "Moisture", render: (r) => r.moisture || "—" },
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

  return (
    <>
      <PageHeader
        title="Issued to Production"
        lede="Every RCN batch issued from a dry bin into production, from the Factory Warehouse RCN Transfer to Production Report."
      />
      <DataTable
        columns={columns}
        rows={rows}
        keyFn={(r) => r.id}
        emptyTitle="Nothing issued to production yet"
      />
      {detail && (
        <RecordDetailModal title={`Issued to Production — BTM ${detail.btmNo || "—"}`} record={detail} onClose={() => setDetail(null)} />
      )}
    </>
  );
}
