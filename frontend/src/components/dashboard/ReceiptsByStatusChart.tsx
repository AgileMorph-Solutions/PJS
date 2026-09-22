import { useMemo } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList,
} from "recharts";
import type { RenderableText } from "recharts/types/component/Text";
import type { ReceiptRecord } from "@anagroci/contract/types/receipt";
import { ALL_STATUSES, STATUS_LABELS, deriveStatus } from "../../domain/receiptStatus";

interface Props {
  receipts: ReceiptRecord[];
}

interface Row {
  status: string;
  label: string;
  count: number;
}

/**
 * Receipt counts across all 10 statuses — richer than the 6 rolled-up KPI tiles above it, and
 * scoped by the same date-range filter.
 *
 * Color, per the dataviz skill's guidance: this is a magnitude comparison across one implicit
 * series (bar height already encodes the count), so every bar shares one dedicated chart hue
 * (--color-chart-primary) EXCEPT "Rejected", which wears the reserved danger color instead — the
 * collision rule ("when a series means good/bad, it wears status tokens, not a generic series
 * color"), matching how the KPI tile above already flags Rejected with tone="gap". Both bars are
 * always direct-labeled (axis category + value-at-tip + tooltip).
 */
export function ReceiptsByStatusChart({ receipts }: Props) {
  const rows: Row[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of ALL_STATUSES) counts.set(s, 0);
    for (const r of receipts) {
      const s = deriveStatus(r);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return ALL_STATUSES.map((status) => ({ status, label: STATUS_LABELS[status], count: counts.get(status) ?? 0 }));
  }, [receipts]);

  const total = rows.reduce((n, r) => n + r.count, 0);
  if (total === 0) {
    return <p className="text-center py-10 text-[13px] text-warmstone-400">No receipts in this date range.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={rows} margin={{ top: 20, right: 12, bottom: 8, left: 0 }} barCategoryGap={8}>
        <CartesianGrid vertical={false} stroke="#e7e5e4" strokeDasharray="0" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "#78716c", fontFamily: "Inter, sans-serif" }}
          tickLine={false}
          axisLine={{ stroke: "#d6d3d1" }}
          interval={0}
          angle={-28}
          textAnchor="end"
          height={54}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: "#78716c", fontFamily: "Inter, sans-serif" }}
          tickLine={false}
          axisLine={false}
          width={28}
        />
        <Tooltip cursor={{ fill: "rgba(28, 25, 23, 0.04)" }} content={<StatusTooltip />} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
          {rows.map((row) => (
            <Cell key={row.status} fill={row.status === "rejected" ? "#b91c1c" : "#0d9488"} />
          ))}
          <LabelList
            dataKey="count"
            position="top"
            formatter={(v: RenderableText) => (typeof v === "number" && v > 0 ? String(v) : "")}
            style={{ fontSize: 11, fontFamily: "Inter, sans-serif", fontWeight: 600, fill: "#1c1917" }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function StatusTooltip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="bg-white border border-warmstone-200 rounded-lg px-3 py-2 shadow-sm">
      <div className="text-[16px] font-bold text-warmstone-900 tabular-nums">{row.count}</div>
      <div className="text-[12px] text-warmstone-500">{row.label}</div>
    </div>
  );
}
