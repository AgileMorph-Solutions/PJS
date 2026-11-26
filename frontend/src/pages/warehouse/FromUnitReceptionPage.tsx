import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { formatDate } from "@anagroci/contract/domain/dateFormat";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { KpiTile } from "../../components/ui/KpiTile";
import { Button } from "../../components/ui/Button";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { ReceptionSourceTabs } from "../../components/receipt/ReceptionSourceTabs";
import { lineLabel, n } from "../../components/transfers/TransferPanel";
import { formatKg } from "../../components/production/batchUi";
import { useDownstreamStatus, useTracking } from "../../state/TrackingContext";
import { useReceptionSources } from "../../state/useReceptionSources";
import { useSite, useSwitchSite } from "../../state/SiteContext";
import { useCanEditDirectly } from "../../state/AuthContext";
import { deriveStatus, computeDashboardCounts, ALL_STATUSES, STATUS_LABELS } from "../../domain/receiptStatus";
import { api } from "../../repository/api";
import { receiptColumns } from "./columns";
import type { TransferRequest } from "../../types/receipt";

const icon = (name: string) => <span className="material-symbols-outlined">{name}</span>;

/**
 * Reception › From Unit warehouse (24 Nov 2026). A truck from the Unit warehouse is received exactly like a supplier truck —
 * the same reception record and steps — one record per lot on it. This tab is the same list as the suppliers' one for those
 * trucks, with the trucks still on the road above it: "Receive truck" starts their reception and opens the first lot's record.
 */
export function FromUnitReceptionPage() {
  const site = useSite();
  const switchSite = useSwitchSite();
  const canEdit = useCanEditDirectly();
  const navigate = useNavigate();
  const { refresh } = useTracking();
  const { status: downstreamStatus } = useDownstreamStatus(site.warehouseName);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const status = params.get("status") ?? "";
  const base = `/${site.slug}/receipts/from-unit`;

  // Trucks sent here that haven't been received yet (none of their lots has a reception record), and the receptions themselves.
  const sources = useReceptionSources();
  const { onTheRoad, unit: receptions, refetchTransfers: refetch } = sources;
  const counts = useMemo(() => computeDashboardCounts(receptions), [receptions]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return receptions
      .filter((r) => !status || deriveStatus(r) === status)
      .filter((r) => !needle || [r.id, r.vehicleNo, r.lotNo, r.binNo, r.transfer?.transferId, r.transfer?.sentAs].some((x) => (x ?? "").toLowerCase().includes(needle)))
      .sort((a, b) => (a.arrivalDate < b.arrivalDate ? 1 : a.arrivalDate > b.arrivalDate ? -1 : a.id < b.id ? 1 : -1));
  }, [receptions, status, q]);

  async function receive(t: TransferRequest) {
    setError(null);
    setStarting(t.id);
    try {
      const { receiptIds } = await api.startTransferReceptions(t.id);
      await Promise.all([refresh(), refetch()]);
      navigate(`/${site.slug}/receipts/${encodeURIComponent(receiptIds[0]!)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(null);
    }
  }

  if (site.type !== "CENTRAL") {
    return (
      <div className="space-y-3">
        <PageHeader kicker={`${site.label} · ${site.sublabel}`} title="Reception" />
        <p className="text-[13px] text-warmstone-800">Only a Central warehouse receives trucks from a Unit warehouse. <Link to={`/${site.slug}/receipts`} className="font-semibold text-brand-700 hover:text-brand-800">Back to Reception</Link></p>
      </div>
    );
  }

  // Every column filters (26 Nov 2026, user), as in the receptions below.
  const roadColumns: Column<TransferRequest>[] = [
    { label: "BKT", filter: { value: (t) => t.id, kind: "select" }, nowrap: true, render: (t) => <span className="font-mono text-[12px]">{t.id}</span> },
    { label: "Dispatched", filter: { value: (t) => t.dispatchedAt, kind: "date" }, nowrap: true, render: (t) => (t.dispatchedAt ? formatDate(t.dispatchedAt) : "-") },
    { label: "From", filter: { value: (t) => t.fromWarehouse, kind: "select" }, render: (t) => t.fromWarehouse },
    { label: "Truck", filter: { value: (t) => t.truckNo, kind: "select" }, nowrap: true, render: (t) => t.truckNo ?? "-" },
    { label: "Driver", filter: { value: (t) => t.driver, kind: "select" }, render: (t) => [t.driver, t.driverPhone].filter(Boolean).join(" · ") || "-" },
    { label: "Lots on it", filter: { value: (t) => t.lines.map(lineLabel).join(", "), kind: "select" }, render: (t) => `${t.lines.map(lineLabel).join(", ")} (${t.lines.length === 1 ? "1 reception" : `${t.lines.length} receptions`})` },
    { label: "Bags sent", filter: { value: (t) => t.variance.bagsDispatched, kind: "number" }, align: "right", nowrap: true, render: (t) => n(t.variance.bagsDispatched) },
    { label: "Net sent", filter: { value: (t) => t.variance.netDispatchedKg, kind: "number" }, align: "right", nowrap: true, render: (t) => (t.variance.netDispatchedKg === null ? "-" : formatKg(t.variance.netDispatchedKg)) },
    ...(canEdit ? [{
      label: "", nowrap: true,
      render: (t: TransferRequest) => <Button icon="inventory_2" disabled={starting !== null} onClick={() => void receive(t)}>{starting === t.id ? "Starting…" : "Receive truck"}</Button>,
    }] : []),
  ];

  return (
    <>
      <PageHeader
        kicker={`${site.label} · ${site.sublabel}`}
        title="Reception"
        lede="Trucks from the Unit warehouse go through the same reception as a supplier's truck: gate, weight, quality, unloading, Lot, Bin and GRN. Each lot on a truck gets its own record. There is no supplier or price; what was sent is shown on each record to compare with."
        actions={<SiteSwitcher value={site.slug} onChange={(s) => s && switchSite(s)} />}
      />

      <ReceptionSourceTabs site={site} counts={sources.counts} unitFrom={sources.unitFrom} />

      {error && <p role="alert" className="px-1 mb-4 text-[13px] text-danger-700">{error}</p>}

      <section className="space-y-3 mb-6">
        <h2 className="text-[17px] font-bold text-warmstone-900">Trucks on the road ({onTheRoad.length})</h2>
        <DataTable columns={roadColumns} rows={onTheRoad} keyFn={(t) => t.id} emptyTitle="No truck on its way" emptyHint="A truck shows here once the Unit warehouse dispatches it." />
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-5">
        <KpiTile icon={icon("local_shipping")} label="Trucks arrived" value={counts.totalReceived} to={base} />
        <KpiTile icon={icon("package_2")} label="Accepted & unloaded" value={counts.acceptedUnloaded} to={`${base}?status=unloaded`} />
        <KpiTile icon={icon("fact_check")} label="GRN completed" value={counts.grnCompleted} to={`${base}?status=grn_completed`} />
        <KpiTile icon={icon("schedule")} label="Pending QA" value={counts.pendingQa} to={`${base}?status=pending_qa`} />
        <KpiTile icon={icon("inventory_2")} label="Pending unload after QA" value={counts.pendingUnload} to={`${base}?status=pending_unload`} />
        <KpiTile icon={icon("cancel")} label="Rejected" value={counts.rejected} to={`${base}?status=rejected`} tone="gap" />
      </div>

      <FilterBar>
        <input placeholder="Search BKT, lot, truck, receipt ID…" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-64" />
        <select value={status} onChange={(e) => setParams((p) => { const next = new URLSearchParams(p); if (e.target.value) next.set("status", e.target.value); else next.delete("status"); return next; })}>
          <option value="">All statuses</option>
          {ALL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
      </FilterBar>

      <DataTable
        columns={receiptColumns(site.stores.length > 1, downstreamStatus, undefined, true)}
        rows={rows}
        keyFn={(r) => r.id}
        rowHref={(r) => `/${site.slug}/receipts/${r.id}`}
        emptyTitle="No truck from the Unit warehouse received yet"
        emptyHint="Use Receive truck above when one arrives."
      />
    </>
  );
}
