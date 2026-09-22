import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
const icon = (name: string) => <span className="material-symbols-outlined">{name}</span>;

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

function ChartCard({
  icon: iconName,
  title,
  note,
  children,
  className = "",
}: {
  icon: string;
  title: string;
  note?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs ${className}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="material-symbols-outlined text-[18px] text-chart-primary">{iconName}</span>
        <h3 className="text-[17px] font-bold text-warmstone-900">{title}</h3>
      </div>
      {note && <p className="text-[13px] text-warmstone-500 leading-relaxed mb-4">{note}</p>}
      {children}
    </div>
  );
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
  // Memoized because `?? []` would otherwise create a new array identity every render when the
  // key is absent, which then falsely invalidates the memoization below it every time.
  const warehouseRows = useMemo(() => ledgerEntries[WAREHOUSE_LEDGER_ID] ?? [], [ledgerEntries]);
  const filteredWarehouseRows = useMemo(
    () => (isFiltered ? warehouseRows.filter((r) => ledgerRowInRange(r, range)) : warehouseRows),
    [warehouseRows, range, isFiltered]
  );
  const balance = lastBalance(filteredWarehouseRows);

  const recent = [...filteredReceipts].sort((a, b) => (a.arrivalDate < b.arrivalDate ? 1 : -1)).slice(0, 8);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="ANAGROCI · TRACKING"
        title="Dashboard"
        lede="RCN receipt status counts as required by the Sept 2026 process notes (doc §3) — every tile links into the register, pre-filtered."
      />

      <DateRangeFilter value={range} onChange={setRange} />

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <KpiTile icon={icon("local_shipping")} label="Total received" value={counts.totalReceived} to="/procurement/receipts" />
        <KpiTile icon={icon("package_2")} label="Accepted & unloaded" value={counts.acceptedUnloaded} to="/procurement/receipts?status=unloaded" />
        <KpiTile icon={icon("fact_check")} label="GRN completed" value={counts.grnCompleted} to="/procurement/receipts?status=grn_completed" />
        <KpiTile icon={icon("schedule")} label="Pending QA" value={counts.pendingQa} to="/procurement/receipts?status=pending_qa" />
        <KpiTile icon={icon("inventory_2")} label="Pending unload after QA" value={counts.pendingUnload} to="/procurement/receipts?status=pending_unload" />
        <KpiTile icon={icon("cancel")} label="Rejected" value={counts.rejected} to="/procurement/receipts?status=rejected" tone="gap" />
      </div>

      <ChartCard
        icon="bar_chart"
        title="Receipts by status"
        note={`Every one of the 10 statuses a receipt can be in${isFiltered ? ", for the selected date range" : ""} — the 6 tiles above roll a few of these up; this is the full breakdown.`}
      >
        <ReceiptsByStatusChart receipts={filteredReceipts} />
      </ChartCard>

      <ChartCard
        icon="warehouse"
        title="Jute bag warehouse stock"
        note="Running balance from BOUAKE WAREHOUSE JUTE BAGS MOVEMENT REPORT.xlsx, continued by anything entered in this app."
      >
        <div className="max-w-xs">
          <KpiTile label="Current balance (bags)" value={balance} to="/jute/warehouse-stock" tone={balance < 0 ? "gap" : "default"} />
        </div>
        <div className="flex items-center gap-2 mt-5 mb-1">
          <span className="material-symbols-outlined text-[18px] text-chart-primary">show_chart</span>
          <h4 className="text-[14px] font-bold text-warmstone-900">Balance over time</h4>
        </div>
        <JuteBalanceTrendChart rows={filteredWarehouseRows} />
      </ChartCard>

      <div className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-chart-primary">history</span>
            <h3 className="text-[17px] font-bold text-warmstone-900">Recent activity</h3>
          </div>
          <Link to="/procurement/receipts" className="text-[12.5px] font-semibold text-brand-700 hover:text-brand-800">
            Open register →
          </Link>
        </div>
        {recent.length === 0 && <p className="text-center py-8 text-[13px] text-warmstone-400">No receipts in this date range.</p>}
        {recent.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-4 py-3 border-b border-warmstone-100 last:border-0 text-[13px]">
            <span className="text-warmstone-600">
              {r.lotNo ? `Lot ${r.lotNo}` : r.id} · {r.supplierName || "—"} · {r.vehicleNo || "—"}
              {r.lotNo && <span className="opacity-60"> · receipt {r.id}</span>}
            </span>
            <ReceiptStatusPill status={deriveStatus(r)} />
          </div>
        ))}
      </div>
    </div>
  );
}
