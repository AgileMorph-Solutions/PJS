import { useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { FilterBar } from "../../components/ui/FilterBar";
import { ReceiptStatusPill } from "../../components/ReceiptStatusPill";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { ImportPanel } from "../../components/ImportPanel";
import { useTracking } from "../../state/TrackingContext";
import { deriveStatus, ALL_STATUSES, STATUS_LABELS } from "../../domain/receiptStatus";
import { stages } from "../../data/stages";
import type { ReceiptRecord } from "../../types/receipt";

/** The real per-truck paperwork, straight from the OFFLOADINGS sheet's "Verify supplier documents"
 * stage — not top-level ReceiptRecord fields, so a small reader avoids repeating the stageData path
 * at every call site. FICHE is the identifier the "Linked records" card (detail page) joins on. */
const verifyField = (r: ReceiptRecord, label: string) => r.stageData["n-verify"]?.[label] ?? "";
const fiche = (r: ReceiptRecord) => verifyField(r, "FICHE");

export function ReceiptsListPage() {
  const { receipts, masters, createReceipt, refresh } = useTracking();
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
          (r.lotNo ?? "").toLowerCase().includes(needle) ||
          fiche(r).toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => (a.arrivalDate < b.arrivalDate ? 1 : -1));
  }, [receipts, status, warehouse, q]);

  const columns: Column<ReceiptRecord>[] = [
    { label: "Receipt ID", render: (r) => <span className="font-mono text-[12.5px]">{r.id}</span> },
    { label: "Arrival date", render: (r) => r.arrivalDate || "—" },
    { label: "Supplier", render: (r) => r.supplierName || "—" },
    { label: "LBA code", render: (r) => <span className="font-mono text-[12.5px]">{r.lbaCode || "—"}</span> },
    { label: "Fiche", render: (r) => <span className="font-mono text-[12.5px]">{fiche(r) || "—"}</span> },
    { label: "Fiche code", render: (r) => <span className="font-mono text-[12.5px]">{verifyField(r, "FICHE CODE") || "—"}</span> },
    { label: "Ref.", render: (r) => <span className="font-mono text-[12.5px]">{verifyField(r, "REF.") || "—"}</span> },
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
    navigate(`/procurement/receipts/new/${id}/${stages[0].id}`);
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

      <div className="mb-5">
        <CollapsibleCard title="Import from workbook">
          <ImportPanel importerId="receipts" onCommitted={() => void refresh()} />
        </CollapsibleCard>
      </div>

      <FilterBar>
        <input
          placeholder="Search vehicle, supplier, LBA code, Fiche, Lot, receipt ID…"
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
