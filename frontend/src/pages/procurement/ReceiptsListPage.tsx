import { useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { FilterBar } from "../../components/ui/FilterBar";
import { ReceiptStatusPill } from "../../components/ReceiptStatusPill";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { useTracking } from "../../state/TrackingContext";
import { deriveStatus, ALL_STATUSES, STATUS_LABELS } from "../../domain/receiptStatus";
import type { ReceiptRecord } from "../../types/receipt";

export function ReceiptsListPage() {
  const { receipts, masters, createReceipt } = useTracking();
  const [params, setParams] = useSearchParams();
  // Reads an initial ?q= from the global header search so a search there lands here pre-filled.
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const navigate = useNavigate();

  const status = params.get("status") ?? "";
  const warehouse = params.get("warehouse") ?? "";

  const rows = useMemo(() => {
    return receipts
      .filter((r) => !status || deriveStatus(r) === status)
      .filter((r) => !warehouse || r.warehouse === warehouse)
      .filter((r) => {
        if (!q.trim()) return true;
        const needle = q.trim().toLowerCase();
        return (
          r.vehicleNo.toLowerCase().includes(needle) ||
          r.supplierName.toLowerCase().includes(needle) ||
          r.id.toLowerCase().includes(needle) ||
          r.lbaCode.toLowerCase().includes(needle) ||
          (r.lotNo ?? "").toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => (a.arrivalDate < b.arrivalDate ? 1 : -1));
  }, [receipts, status, warehouse, q]);

  const columns: Column<ReceiptRecord>[] = [
    { label: "Receipt ID", render: (r) => <span className="font-mono text-[12.5px]">{r.id}</span> },
    { label: "Arrival date", render: (r) => r.arrivalDate || "—" },
    { label: "Supplier", render: (r) => r.supplierName || "—" },
    { label: "LBA code", render: (r) => <span className="font-mono text-[12.5px]">{r.lbaCode || "—"}</span> },
    { label: "Vehicle", render: (r) => r.vehicleNo || "—" },
    { label: "Warehouse", render: (r) => r.warehouse || "—" },
    { label: "Lot / Bin", render: (r) => `${r.lotNo || "—"} / ${r.binNo || "—"}` },
    { label: "Status", render: (r) => <ReceiptStatusPill status={deriveStatus(r)} /> },
    {
      label: "Source",
      render: (r) => (
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
            r.source === "imported" ? "bg-success-100 text-success-800" : "bg-ambernut-100 text-ambernut-800"
          }`}
        >
          {r.source === "imported" ? "imported" : "entered"}
        </span>
      ),
    },
  ];

  async function handleNewReceipt() {
    // Async now: the id is assigned by the server and we navigate straight to it.
    const id = await createReceipt();
    navigate(`/procurement/receipts/new/${id}/n-delplan`);
  }

  return (
    <>
      <PageHeader
        kicker="Procurement"
        title="RCN Receipts"
        lede="Every RCN receipt — open one to fill in or review its stages."
        actions={
          <button
            onClick={handleNewReceipt}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold transition-all shadow-sm"
          >
            <span className="material-symbols-outlined text-[17px]">add</span>
            New RCN receipt
          </button>
        }
      />

      <FilterBar>
        <input
          placeholder="Search vehicle, supplier, LBA code, Lot, receipt ID…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full sm:w-64"
        />
        <select value={status} onChange={(e) => setParams((p) => setOrDelete(p, "status", e.target.value))}>
          <option value="">All statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select value={warehouse} onChange={(e) => setParams((p) => setOrDelete(p, "warehouse", e.target.value))}>
          <option value="">All warehouses</option>
          {masters.warehouses.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
        <span className="ml-auto text-[12.5px] text-warmstone-500">{rows.length} receipts</span>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={rows}
        keyFn={(r) => r.id}
        rowHref={(r) => `/procurement/receipts/${r.id}`}
        emptyTitle="No receipts match these filters"
        emptyHint="Clear the search or filters, or add a new RCN receipt."
      />
    </>
  );
}

function setOrDelete(params: URLSearchParams, key: string, value: string) {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  return next;
}
