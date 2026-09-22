import { useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { FilterBar } from "../../components/ui/FilterBar";
import { StatusPill } from "../../components/ui/StatusPill";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { useTracking } from "../../state/TrackingContext";
import { deriveStatus, ALL_STATUSES, STATUS_LABELS } from "../../domain/receiptStatus";
import { getPhaseWorkbooks } from "../../domain/phaseWorkbooks";
import type { ReceiptRecord } from "../../types/receipt";

const phaseWorkbooks = getPhaseWorkbooks();

export function ReceiptsListPage() {
  const { receipts, masters, createReceipt } = useTracking();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
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
    { label: "Receipt ID", render: (r) => <span className="mono">{r.id}</span> },
    { label: "Arrival date", render: (r) => r.arrivalDate || "—" },
    { label: "Supplier", render: (r) => r.supplierName || "—" },
    { label: "LBA code", render: (r) => <span className="mono">{r.lbaCode || "—"}</span> },
    { label: "Vehicle", render: (r) => r.vehicleNo || "—" },
    { label: "Warehouse", render: (r) => r.warehouse || "—" },
    { label: "Lot / Bin", render: (r) => `${r.lotNo || "—"} / ${r.binNo || "—"}` },
    { label: "Status", render: (r) => <StatusPill status={deriveStatus(r)} /> },
    {
      label: "Source",
      render: (r) => (
        <span className={`field-badge ${r.source === "imported" ? "xl" : "new"}`}>
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
        lede="Every RCN receipt, one row each — from delivery plan through arrival, Lot/Bin, drying, and transfer. Filter, search, and open any record to fill or review its stages in any order."
        actions={
          <button className="btn btn-primary" onClick={handleNewReceipt}>
            + New RCN receipt
          </button>
        }
      />

      <details className="stage-section" style={{ marginBottom: 20 }}>
        <summary>
          <span className="stage-dot done" />
          Source workbooks by phase
          <span className="stage-phase-tag">where each stage's format was extracted from</span>
        </summary>
        <div className="stage-section-body">
          {phaseWorkbooks.map(({ phase, files }) => (
            <div className="summary-row" key={phase} style={{ alignItems: "flex-start" }}>
              <span className="fname" style={{ fontWeight: 600 }}>
                {phase}
              </span>
              <span className="fval" style={{ textAlign: "right" }}>
                {files.length === 0 ? (
                  <span className="field-badge new">no workbook yet — doc-only</span>
                ) : (
                  files.map((f) => (
                    <span className="file-chip" style={{ marginBottom: 0, marginLeft: 8 }} key={f.file}>
                      📄 {f.file}
                      {f.sheet ? ` · ${f.sheet}` : ""}
                    </span>
                  ))
                )}
              </span>
            </div>
          ))}
        </div>
      </details>

      <FilterBar>
        <input
          placeholder="Search vehicle, supplier, LBA code, Lot, receipt ID…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 260 }}
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
        <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--ink-soft)" }}>{rows.length} receipts</span>
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
