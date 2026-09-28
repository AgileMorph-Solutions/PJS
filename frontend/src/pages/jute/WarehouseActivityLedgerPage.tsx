import { useState } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { RecordDetailModal } from "../../components/ui/RecordDetailModal";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { ImportPanel } from "../../components/ImportPanel";
import { useWarehouseActivityLedger } from "../../state/TrackingContext";
import type { WarehouseActivityLedgerEntry } from "../../repository/api";

/**
 * "Warehouse activity Ledger" — a fifth ledger-shaped page alongside the four `juteLedgers.ts`
 * ones, though it isn't one of them (it has no site column, no `real`/`col` ledger definition, and
 * gates purely on "any of its 18 columns non-blank" — see warehouseActivityLedger.ts's own header
 * comment), so it's a plain DataTable here rather than the shared LedgerSection component. Had zero
 * UI before this page (a route existed, nothing on the frontend called it).
 */
export function WarehouseActivityLedgerPage() {
  const { rows, refetch } = useWarehouseActivityLedger();
  const [detail, setDetail] = useState<WarehouseActivityLedgerEntry | null>(null);

  const columns: Column<WarehouseActivityLedgerEntry>[] = [
    { label: "Date", render: (r) => r.activityDate || r.activityDateRaw || "—" },
    { label: "Activity type", render: (r) => r.activityType || "—" },
    { label: "Particulars", render: (r) => r.particulars || "—" },
    { label: "Fiche No.", render: (r) => r.ficheNo || "—" },
    { label: "Lot No.", render: (r) => r.lotNo || "—" },
    { label: "Bags", render: (r) => r.bags || "—" },
    { label: "Vendor", render: (r) => r.vendor || "—" },
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
    <div className="space-y-5">
      <PageHeader
        kicker="Jute Bag Management"
        title="Warehouse Activity Ledger"
        lede="Every logged warehouse activity — no site column in the source, so this list is unscoped."
      />
      <CollapsibleCard title="Import from workbook">
        <ImportPanel importerId="warehouseActivityLedger" onCommitted={() => void refetch()} />
      </CollapsibleCard>
      <DataTable columns={columns} rows={rows} keyFn={(r) => r.id} emptyTitle="No activity ledger rows yet" />
      {detail && (
        <RecordDetailModal title="Warehouse activity ledger entry" record={detail} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}
