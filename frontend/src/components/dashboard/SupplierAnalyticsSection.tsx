import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList } from "recharts";
import type { RenderableText } from "recharts/types/component/Text";
import type { SupplierAnalyticsRow } from "@anagroci/contract/types/receipt";
import { formatDate } from "@anagroci/contract/domain/dateFormat";
import { DataTable, type Column } from "../ui/DataTable";
import { FilterBar } from "../ui/FilterBar";
import { KpiTile } from "../ui/KpiTile";
import { useTableSearch } from "../ui/useTableSearch";
import { useSupplierAnalytics } from "../../state/TrackingContext";
import { useMe } from "../../state/AuthContext";
import { SITE_LIST } from "../../config/sites";
import type { DateRange } from "./DateRangeFilter";

const icon = (name: string) => <span className="material-symbols-outlined">{name}</span>;
const n = (x: number | null | undefined) => (x === null || x === undefined ? "-" : x.toLocaleString());
const pct = (x: number | null) => (x === null ? "-" : `${x}%`);
const TOP = 10;

/**
 * Supplier-wise analytics for the dashboard's date range: how many trucks, bags and kg each supplier delivered, with the
 * quality, rejection, plan and jute figures that go with them. Every line is the same calculation as the supplier's own
 * page (contract domain/supplierPerformance.ts), done on the server; this only lays it out.
 *
 * "Delivered" is GRN kg, the quantity officially recognised into stock. Most imported trucks have no GRN quantity yet, so
 * each line also carries the net kg weighed on arrival and the trucks still awaiting GRN: a 0 beside those reads as "not
 * recorded yet", never "delivered nothing". The tiles are the totals over everything in range.
 */
export function SupplierAnalyticsSection({ range }: { range: DateRange }) {
  const me = useMe();
  // Only an admin can look at another site; an incharge is pinned to their own warehouse by the server.
  const [site, setSite] = useState("");
  const { data, loading, error } = useSupplierAnalytics(range, me.role === "admin" ? site || undefined : undefined);

  const lines = useMemo(() => (data ? [...data.rows, ...(data.noCode ? [data.noCode] : [])] : []), [data]);
  const search = useTableSearch(lines, (r) => [r.name, r.code]);
  const top = useMemo(() => (data?.rows ?? []).filter((r) => r.performance.volumeDeliveredKg > 0).slice(0, TOP), [data]);
  const t = data?.totals;
  const delivering = (data?.rows ?? []).filter((r) => r.performance.acceptedTrucks > 0).length;

  const columns: Column<SupplierAnalyticsRow>[] = [
    {
      label: "Supplier", nowrap: true,
      render: (r) => (
        <span>
          {r.code ? <Link to={`/masters/suppliers/${encodeURIComponent(r.code)}`} className="font-semibold text-brand-700 hover:text-brand-800">{r.name}</Link> : <span className="text-warmstone-500 italic">{r.name}</span>}
          {r.code && <span className="block text-[11px] text-warmstone-400 font-mono">{r.code}{r.status && r.status !== "active" ? ` · ${r.status}` : ""}</span>}
        </span>
      ),
    },
    { label: "Trucks", align: "right", filter: { value: (r) => r.performance.trucksArrived, kind: "number" }, render: (r) => n(r.performance.trucksArrived) },
    { label: "Rejected", align: "right", filter: { value: (r) => r.performance.rejectedTrucks, kind: "number" }, nowrap: true, render: (r) => (r.performance.rejectedTrucks ? `${r.performance.rejectedTrucks} · ${pct(r.performance.rejectionRatePct)}` : "0") },
    {
      label: "Bags", align: "right", filter: { value: (r) => r.performance.bagsDelivered, kind: "number" }, nowrap: true,
      render: (r) => (
        <span>
          {n(r.performance.bagsDelivered)}
          {r.performance.bagsDelivered > 0 && <span className="block text-[11px] text-warmstone-400">{n(r.performance.goodBags)} / {n(r.performance.dampBags)} / {n(r.performance.tornBags)}</span>}
        </span>
      ),
    },
    { label: "Damaged bags", align: "right", filter: { value: (r) => r.performance.damagedBagPct, kind: "number" }, render: (r) => pct(r.performance.damagedBagPct) },
    { label: "GRN kg", align: "right", filter: { value: (r) => r.performance.volumeDeliveredKg, kind: "number" }, nowrap: true, render: (r) => <b>{n(r.performance.volumeDeliveredKg)}</b> },
    { label: "Awaiting GRN", align: "right", filter: { value: (r) => r.performance.trucksAwaitingGrn, kind: "number" }, render: (r) => n(r.performance.trucksAwaitingGrn) },
    { label: "Net weighed kg", align: "right", filter: { value: (r) => r.performance.weighedOnArrivalKg, kind: "number" }, nowrap: true, render: (r) => n(r.performance.weighedOnArrivalKg) },
    { label: "Paid kg", align: "right", filter: { value: (r) => r.performance.paidWeightKg, kind: "number" }, nowrap: true, render: (r) => n(r.performance.paidWeightKg) },
    { label: "Avg KOR", align: "right", filter: { value: (r) => r.performance.averageKor, kind: "number" }, render: (r) => n(r.performance.averageKor) },
    { label: "Avg moisture %", align: "right", filter: { value: (r) => r.performance.averageMoisture, kind: "number" }, render: (r) => n(r.performance.averageMoisture) },
    { label: "Target kg", align: "right", filter: { value: (r) => r.performance.targetKg, kind: "number" }, nowrap: true, render: (r) => n(r.performance.targetKg) },
    { label: "Achievement", align: "right", filter: { value: (r) => r.performance.achievementPct, kind: "number" }, render: (r) => pct(r.performance.achievementPct) },
    { label: "Jute bags with supplier", align: "right", filter: { value: (r) => r.performance.juteBagBalance, kind: "number" }, render: (r) => n(r.performance.juteBagBalance) },
    { label: "Last delivery", filter: { value: (r) => r.performance.lastDeliveryDate, kind: "date" }, nowrap: true, render: (r) => formatDate(r.performance.lastDeliveryDate) || "-" },
  ];

  return (
    <section className="space-y-5" aria-label="Supplier analytics">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-chart-primary">groups</span>
            <h3 className="text-[17px] font-bold text-warmstone-900">Suppliers</h3>
          </div>
          <p className="text-[13px] text-warmstone-500 mt-1 max-w-2xl">
            What each supplier delivered in the selected dates. Delivered means the GRN quantity; trucks still awaiting their GRN are counted separately and their weighed kg is shown beside it.
          </p>
        </div>
        {me.role === "admin" && (
          <label className="flex flex-col gap-1.5 text-[11px] font-bold uppercase tracking-wider text-warmstone-500">
            Site
            <select value={site} onChange={(e) => setSite(e.target.value)} className="px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] font-normal normal-case tracking-normal text-warmstone-900 outline-none focus:border-brand-700">
              <option value="">All sites</option>
              {SITE_LIST.map((s) => <option key={s.slug} value={s.warehouseName}>{s.label} · {s.sublabel}</option>)}
            </select>
          </label>
        )}
      </div>

      {error && <p role="alert" className="text-[13px] text-danger-700">Could not load supplier figures: {error}</p>}
      {!data && loading && <p className="text-[13px] text-warmstone-400">Loading supplier figures…</p>}

      {data && t && (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
            <KpiTile icon={icon("groups")} label="Suppliers delivering" value={delivering} />
            <KpiTile icon={icon("scale")} label="GRN kg (recognised)" value={n(t.volumeDeliveredKg)} />
            <KpiTile icon={icon("hourglass_top")} label="Trucks awaiting GRN" value={n(t.trucksAwaitingGrn)} />
            <KpiTile icon={icon("shopping_bag")} label="Bags delivered" value={n(t.bagsDelivered)} />
            <KpiTile icon={icon("heart_broken")} label="Damaged bags" value={pct(t.damagedBagPct)} />
            <KpiTile icon={icon("science")} label="Average KOR" value={n(t.averageKor)} />
          </div>

          <div className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs mt-5">
            <h4 className="text-[14px] font-bold text-warmstone-900 mb-1">Top suppliers by GRN kg</h4>
            <p className="text-[12.5px] text-warmstone-500 mb-3">
              {top.length ? `The ${top.length} biggest, by quantity recognised into stock. The table below has every supplier.` : ""}
            </p>
            {top.length === 0
              ? <p className="text-center py-8 text-[13px] text-warmstone-400">No GRN quantity is recorded for these dates yet. The table below shows the kg weighed on arrival.</p>
              : <TopSuppliersChart rows={top} />}
          </div>

          <div className="mt-5">
            <FilterBar>
              <input placeholder="Search supplier name or code…" value={search.q} onChange={(e) => search.setQ(e.target.value)} className="w-full sm:w-64" />
            </FilterBar>
            <DataTable columns={columns} rows={search.filtered} keyFn={(r) => r.code || "no-code"} emptyTitle="No suppliers in these dates" emptyHint="Widen the date range, or check that trucks carry an LBA code." />
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * One series (GRN kg), so one hue (--color-chart-primary, validated on a white surface) and no legend: the card title names
 * it. Every bar is direct-labelled at its tip, the supplier name is the axis, and the table below is the table view.
 */
function TopSuppliersChart({ rows }: { rows: SupplierAnalyticsRow[] }) {
  const data = rows.map((r) => ({ name: r.name.length > 24 ? `${r.name.slice(0, 23)}…` : r.name, full: r.name, kg: r.performance.volumeDeliveredKg, row: r }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 34 + 24)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 4 }} barCategoryGap={8}>
        <CartesianGrid horizontal={false} stroke="#e7e5e4" />
        <XAxis type="number" tick={{ fontSize: 11, fill: "#78716c", fontFamily: "Inter, sans-serif" }} tickLine={false} axisLine={{ stroke: "#d6d3d1" }} tickFormatter={(v: number) => v.toLocaleString()} />
        <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12, fill: "#44403c", fontFamily: "Inter, sans-serif" }} tickLine={false} axisLine={false} interval={0} />
        <Tooltip cursor={{ fill: "rgba(28, 25, 23, 0.04)" }} content={<SupplierTooltip />} />
        <Bar dataKey="kg" fill="#0d9488" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}>
          <LabelList dataKey="kg" position="right" formatter={(v: RenderableText) => (typeof v === "number" ? v.toLocaleString() : "")} style={{ fontSize: 11, fontFamily: "Inter, sans-serif", fontWeight: 600, fill: "#1c1917" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function SupplierTooltip({ active, payload }: { active?: boolean; payload?: { payload: { full: string; kg: number; row: SupplierAnalyticsRow } }[] }) {
  if (!active || !payload?.length) return null;
  const { full, kg, row } = payload[0].payload;
  const p = row.performance;
  return (
    <div className="bg-white border border-warmstone-200 rounded-lg px-3 py-2 shadow-sm">
      <div className="text-[16px] font-bold text-warmstone-900 tabular-nums">{kg.toLocaleString()} kg</div>
      <div className="text-[12px] text-warmstone-500">{full}</div>
      <div className="text-[12px] text-warmstone-500 tabular-nums mt-1">{p.acceptedTrucks} trucks · {n(p.bagsDelivered)} bags{p.trucksAwaitingGrn ? ` · ${p.trucksAwaitingGrn} awaiting GRN` : ""}</div>
    </div>
  );
}
