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
 * series (bar height already encodes the count), so every bar shares one sequential brand hue
 * (--chart-primary) EXCEPT "Rejected", which wears the reserved danger/status color instead —
 * the collision rule ("when a series means good/bad, it wears status tokens, not a generic
 * series color"), matching how the KPI tile above already flags Rejected with tone="gap". The
 * --chart-primary/--danger-border pair is validated together — see tokens.css's comment — and
 * both bars are always direct-labeled (axis category + value-at-tip + tooltip), which the skill
 * requires as the secondary encoding for that pairing's CVD band.
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
    return <p className="chart-empty">No receipts in this date range.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={rows} margin={{ top: 20, right: 12, bottom: 8, left: 0 }} barCategoryGap={8}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="0" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "var(--ink-soft)", fontFamily: "Inter, sans-serif" }}
          tickLine={false}
          axisLine={{ stroke: "var(--chart-axis)" }}
          interval={0}
          angle={-28}
          textAnchor="end"
          height={54}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: "var(--ink-soft)", fontFamily: "IBM Plex Mono, monospace" }}
          tickLine={false}
          axisLine={false}
          width={28}
        />
        <Tooltip cursor={{ fill: "rgba(35, 57, 47, 0.05)" }} content={<StatusTooltip />} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
          {rows.map((row) => (
            <Cell key={row.status} fill={row.status === "rejected" ? "var(--danger-border)" : "var(--chart-primary)"} />
          ))}
          <LabelList
            dataKey="count"
            position="top"
            formatter={(v: RenderableText) => (typeof v === "number" && v > 0 ? String(v) : "")}
            style={{ fontSize: 11, fontFamily: "IBM Plex Mono, monospace", fill: "var(--ink)" }}
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
    <div
      style={{
        background: "var(--chart-tooltip-bg)",
        border: "1px solid var(--chart-tooltip-border)",
        borderRadius: 8,
        padding: "8px 12px",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 16, fontWeight: 600, color: "var(--ink)" }}>
        {row.count}
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{row.label}</div>
    </div>
  );
}
