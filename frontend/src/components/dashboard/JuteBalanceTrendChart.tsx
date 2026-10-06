import { useMemo } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ReferenceDot,
} from "recharts";
import type { LedgerRow } from "@anagroci/contract/types/receipt";

interface Props {
  rows: LedgerRow[];
}

interface Point {
  date: string;
  sortKey: number;
  balance: number;
}

/**
 * Most Date cells in the source workbook are real dates; 11 are hand-typed "DD-MM-YYYY" text
 * (see tools/extract-jute.py's rawDate handling) that `new Date(...)` misreads as month-first.
 * Parsed here rather than trusted to the platform date parser, so those 11 rows still sort
 * correctly instead of landing in the wrong month.
 */
export function parseLedgerDate(raw: string): number | null {
  if (!raw) return null;
  const iso = Date.parse(raw);
  if (!Number.isNaN(iso) && /^\d{4}-\d{2}-\d{2}/.test(raw)) return iso;
  const dmy = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return Date.UTC(Number(y), Number(m) - 1, Number(d));
  }
  return Number.isNaN(iso) ? null : iso;
}

/**
 * The running warehouse-stock balance over time — the same server-computed number already shown
 * as a single KPI tile above, now plotted across the real ~298 rows so its documented decline
 * into negative territory (a genuine client-facing data-quality finding, not a chart artifact) is
 * visible rather than only a static current figure.
 *
 * One series, one hue (--color-chart-primary) — a single line needs no legend box; the chart's own
 * heading names it. The area below the zero baseline is washed in the reserved danger tone as a
 * secondary encoding of "this is the bad side of the line," matching the same tone the KPI tile
 * above already flips to when the balance is negative — not a second series, just the zone below a
 * meaningful threshold.
 */
export function JuteBalanceTrendChart({ rows }: Props) {
  const points: Point[] = useMemo(() => {
    const parsed = rows
      .map((r): Point | null => {
        const sortKey = parseLedgerDate(r["Date"] ?? "");
        const balance = Number(r["Balance"]);
        if (sortKey === null || !Number.isFinite(balance)) return null;
        return { date: r["Date"], sortKey, balance };
      })
      .filter((p): p is Point => p !== null);
    parsed.sort((a, b) => a.sortKey - b.sortKey);
    return parsed;
  }, [rows]);

  if (points.length === 0) {
    return <p className="text-center py-10 text-[13px] text-warmstone-400">No jute warehouse-stock movements in this date range.</p>;
  }

  const values = points.map((p) => p.balance);
  const minBalance = Math.min(0, ...values);
  const maxBalance = Math.max(0, ...values);
  const last = points[points.length - 1];
  // Thin x-axis ticks — 298 points would otherwise overlap into an unreadable smear of labels.
  const tickInterval = Math.max(0, Math.ceil(points.length / 8) - 1);

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={points} margin={{ top: 20, right: 48, bottom: 8, left: 0 }}>
        <CartesianGrid vertical={false} stroke="#e7e5e4" strokeDasharray="0" />
        {minBalance < 0 && (
          <>
            {/* The below-zero band, washed in the reserved danger tone the KPI tile above already
                flips to when this balance goes negative - a secondary encoding, not a series. */}
            {/* recharts 3.10's public ReferenceArea prop type omits `fill`/`style` (an upstream
                type-surface gap - the prop works fine at runtime, just not through its own JSX
                props), so the fill is applied via `shape`, its documented custom-render escape
                hatch, instead. */}
            <ReferenceArea
              y1={minBalance}
              y2={0}
              ifOverflow="extendDomain"
              shape={(props: { x?: number; y?: number; width?: number; height?: number }) => (
                <rect x={props.x} y={props.y} width={props.width} height={props.height} fill="rgb(185 28 28 / 10%)" />
              )}
            />
            <ReferenceLine
              y={0}
              stroke="#d6d3d1"
              strokeWidth={1}
              label={{ value: "0", position: "insideLeft", fill: "#78716c", fontSize: 11 }}
            />
          </>
        )}
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "#78716c", fontFamily: "Inter, sans-serif" }}
          tickLine={false}
          axisLine={{ stroke: "#d6d3d1" }}
          interval={tickInterval}
          minTickGap={24}
        />
        <YAxis
          domain={[minBalance, maxBalance]}
          tick={{ fontSize: 11, fill: "#78716c", fontFamily: "Inter, sans-serif" }}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v: number) => v.toLocaleString()}
        />
        <Tooltip cursor={{ stroke: "#d6d3d1", strokeWidth: 1 }} content={<BalanceTooltip />} />
        <Line
          type="monotone"
          dataKey="balance"
          stroke="#0d9488"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 5, fill: "#0d9488", stroke: "#ffffff", strokeWidth: 2 }}
          isAnimationActive={false}
        />
        <ReferenceDot
          x={last.date}
          y={last.balance}
          r={5}
          fill={last.balance < 0 ? "#b91c1c" : "#0d9488"}
          stroke="#ffffff"
          strokeWidth={2}
          label={{
            value: last.balance.toLocaleString(),
            position: "right",
            fill: last.balance < 0 ? "#b91c1c" : "#1c1917",
            fontSize: 12,
            fontFamily: "Inter, sans-serif",
            fontWeight: 600,
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function BalanceTooltip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-white border border-warmstone-200 rounded-lg px-3 py-2 shadow-sm">
      <div className={`text-[16px] font-bold tabular-nums ${p.balance < 0 ? "text-danger-700" : "text-warmstone-900"}`}>
        {p.balance.toLocaleString()} bags
      </div>
      <div className="text-[12px] text-warmstone-500">{p.date}</div>
    </div>
  );
}
