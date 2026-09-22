import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Truck, PackageCheck, FileCheck, Clock, Package, XCircle, Warehouse, History, BarChart3, LineChart as LineChartIcon } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { KpiTile } from "../components/ui/KpiTile";
import { ReceiptStatusPill } from "../components/ReceiptStatusPill";
import { DateRangeFilter, type DateRange } from "../components/dashboard/DateRangeFilter";
import { ReceiptsByStatusChart } from "../components/dashboard/ReceiptsByStatusChart";
import { JuteBalanceTrendChart, parseLedgerDate } from "../components/dashboard/JuteBalanceTrendChart";
import { useTracking } from "../state/TrackingContext";
import { computeDashboardCounts, deriveStatus } from "../domain/receiptStatus";
import { lastBalance } from "../domain/jute";
import type { LedgerRow } from "../repository/juteRepo";

const WAREHOUSE_LEDGER_ID = "warehouse-stock";

/** Inclusive lexicographic range check — arrivalDate is always "YYYY-MM-DD", so string comparison
 * is chronological comparison. Empty from/to means unbounded on that side. */
function inRange(dateStr: string, range: DateRange): boolean {
  if (!dateStr) return false;
  if (range.from && dateStr < range.from) return false;
  if (range.to && dateStr > range.to) return false;
  return true;
}

/** Same idea as inRange, but for jute ledger rows — the "Date" field isn't always ISO (11 rows
 * are hand-typed DD-MM-YYYY text), so this compares parsed timestamps, not raw strings. */
function ledgerRowInRange(row: LedgerRow, range: DateRange): boolean {
  const ts = parseLedgerDate(row["Date"] ?? "");
  if (ts === null) return false;
  if (range.from) {
    const from = parseLedgerDate(range.from);
    if (from !== null && ts < from) return false;
  }
  if (range.to) {
    const to = parseLedgerDate(range.to);
    if (to !== null && ts > to) return false;
  }
  return true;
}

export function DashboardPage() {
  const { receipts, ledgerEntries } = useTracking();
  const [range, setRange] = useState<DateRange>({ from: "", to: "" });
  const isFiltered = Boolean(range.from || range.to);

  const filteredReceipts = useMemo(
    () => (isFiltered ? receipts.filter((r) => inRange(r.arrivalDate, range)) : receipts),
    [receipts, range, isFiltered]
  );
  const counts = useMemo(() => computeDashboardCounts(filteredReceipts), [filteredReceipts]);

  // The server already computes the running balance (the SQL view with no column to drift — see
  // backend/README.md); this just reads it. NOT using allRowsFor() here — that prepends
  // juteBags.ts's hardcoded demo sample rows ahead of the real server-loaded rows, which was
  // already identified and removed from LedgerSection.tsx for the same reason: the server now
  // serves the real rows, the samples are among them, prepending them again double-counts.
  const warehouseRows = ledgerEntries[WAREHOUSE_LEDGER_ID] ?? [];
  const filteredWarehouseRows = useMemo(
    () => (isFiltered ? warehouseRows.filter((r) => ledgerRowInRange(r, range)) : warehouseRows),
    [warehouseRows, range, isFiltered]
  );
  const balance = lastBalance(filteredWarehouseRows);

  const recent = [...filteredReceipts]
    .sort((a, b) => (a.arrivalDate < b.arrivalDate ? 1 : -1))
    .slice(0, 8);

  return (
    <>
      <PageHeader
        kicker="ANAGROCI · TRACKING"
        title="Dashboard"
        lede="RCN receipt status counts as required by the Sept 2026 process notes (doc §3) — every tile links into the register, pre-filtered."
      />

      <DateRangeFilter value={range} onChange={setRange} />

      <div className="kpi-grid">
        <KpiTile icon={<Truck />} label="Total received" value={counts.totalReceived} to="/procurement/receipts" />
        <KpiTile icon={<PackageCheck />} label="Accepted & unloaded" value={counts.acceptedUnloaded} to="/procurement/receipts?status=unloaded" />
        <KpiTile icon={<FileCheck />} label="GRN completed" value={counts.grnCompleted} to="/procurement/receipts?status=grn_completed" />
        <KpiTile icon={<Clock />} label="Pending QA" value={counts.pendingQa} to="/procurement/receipts?status=pending_qa" />
        <KpiTile icon={<Package />} label="Pending unload after QA" value={counts.pendingUnload} to="/procurement/receipts?status=pending_unload" />
        <KpiTile icon={<XCircle />} label="Rejected" value={counts.rejected} to="/procurement/receipts?status=rejected" tone="gap" />
      </div>

      <div className="card">
        <div className="chart-card-heading">
          <BarChart3 aria-hidden="true" />
          <h3>Receipts by status</h3>
        </div>
        <p className="chart-card-note">
          Every one of the 10 statuses a receipt can be in{isFiltered ? ", for the selected date range" : ""} — the 6 tiles
          above roll a few of these up; this is the full breakdown.
        </p>
        <ReceiptsByStatusChart receipts={filteredReceipts} />
      </div>

      <div className="card">
        <div className="chart-card-heading">
          <Warehouse aria-hidden="true" />
          <h3>Jute bag warehouse stock</h3>
        </div>
        <p className="chart-card-note">
          Running balance from <span className="mono">BOUAKE WAREHOUSE JUTE BAGS MOVEMENT REPORT.xlsx</span>, continued by
          anything entered in this app.
        </p>
        <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <KpiTile
            label="Current balance (bags)"
            value={balance}
            to="/jute/warehouse-stock"
            tone={balance < 0 ? "gap" : "default"}
          />
        </div>
        <div className="chart-card-heading" style={{ marginTop: 20 }}>
          <LineChartIcon aria-hidden="true" />
          <h3>Balance over time</h3>
        </div>
        <JuteBalanceTrendChart rows={filteredWarehouseRows} />
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div className="chart-card-heading" style={{ marginBottom: 0 }}>
            <History aria-hidden="true" />
            <h3>Recent activity</h3>
          </div>
          <Link to="/procurement/receipts" style={{ fontSize: 12.5, fontWeight: 600 }}>
            Open register →
          </Link>
        </div>
        {recent.length === 0 && <p className="chart-empty">No receipts in this date range.</p>}
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
