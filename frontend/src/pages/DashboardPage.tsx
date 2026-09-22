import { useMemo } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { KpiTile } from "../components/ui/KpiTile";
import { ReceiptStatusPill } from "../components/ReceiptStatusPill";
import { useTracking } from "../state/TrackingContext";
import { computeDashboardCounts, deriveStatus } from "../domain/receiptStatus";
import { juteLedgers } from "../data/juteBags";
import { allRowsFor, lastBalance } from "../domain/jute";

export function DashboardPage() {
  const { receipts, ledgerEntries } = useTracking();
  const counts = useMemo(() => computeDashboardCounts(receipts), [receipts]);

  const warehouseLedger = juteLedgers.find((l) => l.id === "warehouse-stock")!;
  const balance = lastBalance(allRowsFor(warehouseLedger, ledgerEntries[warehouseLedger.id] ?? []));

  const recent = [...receipts]
    .sort((a, b) => (a.arrivalDate < b.arrivalDate ? 1 : -1))
    .slice(0, 8);

  return (
    <>
      <PageHeader
        kicker="ANAGROCI · TRACKING"
        title="Dashboard"
        lede="RCN receipt status counts as required by the Sept 2026 process notes (doc §3) — every tile links into the register, pre-filtered."
      />

      <div className="kpi-grid">
        <KpiTile label="Total received" value={counts.totalReceived} to="/procurement/receipts" />
        <KpiTile label="Accepted & unloaded" value={counts.acceptedUnloaded} to="/procurement/receipts?status=unloaded" />
        <KpiTile label="GRN completed" value={counts.grnCompleted} to="/procurement/receipts?status=grn_completed" />
        <KpiTile label="Pending QA" value={counts.pendingQa} to="/procurement/receipts?status=pending_qa" />
        <KpiTile label="Pending unload after QA" value={counts.pendingUnload} to="/procurement/receipts?status=pending_unload" />
        <KpiTile label="Rejected" value={counts.rejected} to="/procurement/receipts?status=rejected" tone="gap" />
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 10 }}>Jute bag warehouse stock</h3>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 10 }}>
          Running balance from <span className="mono">BOUAKE WAREHOUSE JUTE BAGS MOVEMENT REPORT.xlsx</span>,
          continued by anything entered in this app.
        </p>
        <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <KpiTile label="Current balance (bags)" value={balance} to="/jute/warehouse-stock" tone={balance < 0 ? "gap" : "default"} />
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Recent activity</h3>
          <Link to="/procurement/receipts" style={{ fontSize: 12.5, fontWeight: 600 }}>
            Open register →
          </Link>
        </div>
        {recent.map((r) => (
          <div className="summary-row" key={r.id}>
            <span className="fname">
              {r.lotNo ? `Lot ${r.lotNo}` : r.id} · {r.supplierName || "—"} · {r.vehicleNo || "—"}
              {r.lotNo && <span style={{ opacity: 0.6 }}> · receipt {r.id}</span>}
            </span>
            <ReceiptStatusPill status={deriveStatus(r)} />
          </div>
        ))}
      </div>
    </>
  );
}
