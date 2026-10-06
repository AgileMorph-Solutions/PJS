import { useMemo, useState } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { useTracking } from "../../state/TrackingContext";
import { deriveStatus, ALL_STATUSES, STATUS_LABELS } from "../../domain/receiptStatus";
import { ReceiptStatusPill } from "../../components/ReceiptStatusPill";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatBlock } from "../../components/ui/StatBlock";
import type { ReceiptRecord } from "../../types/receipt";
import type { ReceiptStatus } from "@anagroci/contract/types/receipt";

export function BinDetailPage() {
  const { binNo = "" } = useParams();
  const { receipts, masters } = useTracking();
  const [status, setStatus] = useState<ReceiptStatus | "">("");
  const inBin = useMemo(() => receipts.filter((r) => r.binNo === binNo), [receipts, binNo]);
  // Called unconditionally, ahead of the not-a-real-bin early return below — React's hooks-order
  // rule, same reason the `inBin` useMemo above it also sits ahead of that return.
  const search = useTableSearch(inBin, (r) => [r.lotNo, r.supplierName, r.vehicleNo]);

  if (!masters.bins.includes(binNo)) return <Navigate to="/masters/bins" replace />;

  const distinctLots = new Set(inBin.map((r) => r.lotNo).filter(Boolean)).size;
  const inDryingCount = inBin.filter((r) => deriveStatus(r) === "in_drying").length;
  const rejectedCount = inBin.filter((r) => deriveStatus(r) === "rejected").length;
  const rows = status ? search.filtered.filter((r) => deriveStatus(r) === status) : search.filtered;

  const columns: Column<ReceiptRecord>[] = [
    { label: "Lot No", render: (r) => <span className="font-mono text-[12.5px]">{r.lotNo || r.id}</span> },
    { label: "Supplier", render: (r) => r.supplierName || "-" },
    { label: "Vehicle", render: (r) => r.vehicleNo || "-" },
    { label: "Status", render: (r) => <ReceiptStatusPill status={deriveStatus(r)} /> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-[13px] text-warmstone-500">
        <Link to="/masters/bins" className="hover:text-warmstone-900 font-medium transition-colors">
          Bins
        </Link>
        <span className="material-symbols-outlined text-[14px] text-warmstone-300">chevron_right</span>
        <span className="font-bold text-warmstone-900 bg-warmstone-100 px-2.5 py-0.5 rounded-md border border-warmstone-200">
          {binNo}
        </span>
      </div>

      <PageHeader
        kicker="Masters"
        title={`Bin ${binNo}`}
        lede="Every receipt currently stored in this Bin."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatBlock icon="inventory_2" label="Lots stored" value={String(distinctLots)} sub="Distinct Lot numbers" />
        <StatBlock icon="receipt_long" label="Receipts" value={String(inBin.length)} />
        <StatBlock icon="wb_sunny" label="In drying" value={String(inDryingCount)} />
        <StatBlock icon="cancel" label="Rejected" value={String(rejectedCount)} tone={rejectedCount ? "danger" : "default"} />
      </div>

      <FilterBar>
        <input
          placeholder="Search lot, supplier, vehicle…"
          value={search.q}
          onChange={(e) => search.setQ(e.target.value)}
          className="w-full sm:w-64"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value as ReceiptStatus | "")}>
          <option value="">All statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={rows}
        keyFn={(r) => r.id}
        rowHref={(r) => `/procurement/receipts/${r.id}`}
        emptyTitle="No receipts currently in this Bin"
      />
    </div>
  );
}
