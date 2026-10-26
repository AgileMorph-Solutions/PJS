import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PLAN_STATUS_LABELS, type PlanStatus } from "@anagroci/contract/domain/deliveryPlan";
import { PageHeader } from "../../components/ui/PageHeader";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { Pill } from "../../components/ui/Pill";
import { KpiTile } from "../../components/ui/KpiTile";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { useDeliveryPlans } from "../../state/TrackingContext";
import { useSite, useSwitchSite } from "../../state/SiteContext";
import { useCanEditDirectly } from "../../state/AuthContext";
import { api } from "../../repository/api";
import { DeliveryPlanForm, emptyPlanForm } from "../../components/receipt/DeliveryPlanForm";
import type { DeliveryPlan } from "../../types/receipt";
import { normalizeSupplierName } from "@anagroci/contract/domain/supplierCode";
import { formatDate, todayIso } from "@anagroci/contract/domain/dateFormat";

const STATUS_TONE: Record<PlanStatus, string> = { planned: "decision", partially_received: "term", delivered: "entry", cancelled: "gap" };

const inputClass =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700";

const today = todayIso;
const kg = (n: number | null) => (n === null ? "-" : n.toLocaleString());
/** The Status column's filter value — also what `?overdue` pre-ticks, so the two can't drift apart. */
const statusFilterValue = (p: DeliveryPlan) => PLAN_STATUS_LABELS[p.status] + (p.overdue ? " (overdue)" : "");

/**
 * What is expected to arrive, recorded before the truck comes — a pre-alert, so the warehouse can
 * prepare space, people, weighbridge and quality control. One plan covers several trucks, and a
 * truck may still arrive with no plan at all. The plan creates no stock and is not the reception:
 * everything under "Received" is derived from the trucks recorded against it, never typed here.
 */
export function DeliveryPlansPage() {
  const site = useSite();
  const switchSite = useSwitchSite();
  const canEdit = useCanEditDirectly();
  const { plans, loading, refetch } = useDeliveryPlans(site.warehouseName);
  // `?overdue` (the dashboard's "Overdue plans" tile, and the Overdue tile here) opens the table with the Status
  // filter ticked on every overdue value actually present — the checklist only offers values in the rows.
  const [params] = useSearchParams();
  const overdueOnly = params.has("overdue");
  const overduePlans = useMemo(() => plans.filter((p) => p.overdue), [plans]);
  const overdueCount = overduePlans.length;
  const overdueFilter = useMemo(
    () => (overdueOnly && overduePlans.length ? { Status: { selected: [...new Set(overduePlans.map(statusFilterValue))] } } : undefined),
    [overdueOnly, overduePlans]
  );
  // Cancelled plans are left out: their trucks are exceptions, not progress against an expectation.
  const totals = useMemo(() => {
    const live = plans.filter((p) => p.status !== "cancelled");
    const sum = (f: (p: DeliveryPlan) => number) => live.reduce((n, p) => n + f(p), 0);
    return {
      plans: live.length, arrived: sum((p) => p.progress.arrivals), accepted: sum((p) => p.progress.acceptedTrucks),
      rejected: sum((p) => p.progress.rejectedTrucks), expectedKg: sum((p) => p.expectedQuantityKg ?? 0), receivedKg: sum((p) => p.progress.actualKg),
    };
  }, [plans]);
  const search = useTableSearch(plans, (p) => [p.id, p.supplierName, p.supplierCode, p.expectedOrigin, p.fundingReference, p.truckNos.join(" "), p.remarks]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  async function run(action: () => Promise<unknown>) {
    setError(null);
    setSaving(true);
    try { await action(); await refetch(); return true; } catch (err) { setError(err instanceof Error ? err.message : String(err)); return false; } finally { setSaving(false); }
  }

  async function confirmCancel(plan: DeliveryPlan) {
    if (await run(() => api.updateDeliveryPlan(plan.id, { cancelled: true, cancelReason: reason }))) { setCancelling(null); setReason(""); }
  }

  const linkClass = "text-[11.5px] font-semibold text-brand-700 hover:text-brand-800 whitespace-nowrap";
  // Six columns, not thirteen: what a plan IS, when, how far it got, its trucks, its state, and what can be done to it.
  // Everything else (receipt ids, funding reference, per-truck steps) is one click away on the plan's own page.
  const columns: Column<DeliveryPlan>[] = [
    {
      label: "Plan", nowrap: true,
      render: (p) => (
        <div>
          <div className="font-mono text-[12.5px] font-semibold text-brand-700">{p.id}</div>
          <div className="text-[12px] text-warmstone-500">{normalizeSupplierName(p.supplierName)}{p.supplierCode ? ` · ${p.supplierCode}` : ""}</div>
        </div>
      ),
    },
    {
      label: "Expected", filter: { value: (p) => p.expectedArrivalDate, kind: "date" },
      render: (p) => (
        <div>
          <div className="whitespace-nowrap">{p.expectedDeliveryEnd ? `${formatDate(p.expectedArrivalDate)} → ${formatDate(p.expectedDeliveryEnd)}` : formatDate(p.expectedArrivalDate)}</div>
          <div className="text-[12px] text-warmstone-500">{p.expectedOrigin ? `${p.expectedOrigin} → ` : ""}{p.destinationWarehouse}{p.destinationStore ? ` · ${p.destinationStore}` : ""}</div>
        </div>
      ),
    },
    {
      label: "Received vs planned", filter: { value: (p) => p.progress.actualKg, kind: "number" },
      render: (p) => {
        const { actualKg, remainingKg, varianceKg } = p.progress;
        const planned = p.expectedQuantityKg;
        return (
          <div className="min-w-[170px] space-y-1">
            {planned !== null && <ProgressBar value={actualKg} max={planned} tone={varianceKg !== null && varianceKg > 0 ? "over" : "default"} label="Received against planned kg" />}
            <div className="text-[12px] tabular-nums text-warmstone-700">{kg(actualKg)}{planned !== null ? ` of ${kg(planned)} kg` : " kg received"}</div>
            {remainingKg !== null && varianceKg !== null && (
              <div className={`text-[11.5px] font-semibold ${varianceKg > 0 ? "text-ambernut-700" : remainingKg > 0 && actualKg > 0 ? "text-warmstone-500" : "text-success-700"}`}>
                {varianceKg > 0 ? `+${kg(varianceKg)} kg over plan` : remainingKg > 0 ? `${kg(remainingKg)} kg still to come` : "fully received"}
              </div>
            )}
          </div>
        );
      },
    },
    {
      label: "Trucks", filter: { value: (p) => p.progress.rejectedTrucks > 0 ? "Has rejected trucks" : p.progress.arrivals === 0 ? "None arrived yet" : p.progress.awaitingGrnTrucks > 0 ? "Awaiting GRN" : "All accepted", kind: "select" },
      render: (p) => {
        const { arrivals, acceptedTrucks, rejectedTrucks, awaitingGrnTrucks } = p.progress;
        const chip = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap";
        return (
          <div className="space-y-1">
            <div className="text-[12px] text-warmstone-600 whitespace-nowrap">{arrivals}{p.expectedTrucks === null ? "" : ` of ${p.expectedTrucks}`} arrived</div>
            <div className="flex flex-wrap gap-1.5">
              {acceptedTrucks > 0 && <span className={`${chip} bg-success-100 text-success-800 border-success-200`}>{acceptedTrucks} accepted</span>}
              {rejectedTrucks > 0 && <span className={`${chip} bg-danger-100 text-danger-700 border-danger-200`}>{rejectedTrucks} rejected</span>}
              {awaitingGrnTrucks > 0 && <span className={`${chip} bg-ambernut-100 text-ambernut-800 border-ambernut-200`}>{awaitingGrnTrucks} awaiting GRN</span>}
              {arrivals === 0 && <span className="text-[11.5px] text-warmstone-400">none yet</span>}
            </div>
          </div>
        );
      },
    },
    {
      label: "Status", filter: { value: statusFilterValue, kind: "select" }, nowrap: true,
      render: (p) => (
        <span className="inline-flex flex-col items-start gap-1">
          <Pill tone={STATUS_TONE[p.status]} label={PLAN_STATUS_LABELS[p.status]} />
          {p.overdue && <span className="text-[10.5px] font-semibold text-danger-700">overdue</span>}
          {p.status === "cancelled" && p.cancelReason && <span className="text-[11px] text-warmstone-500 max-w-[11rem] whitespace-normal">{p.cancelReason}</span>}
        </span>
      ),
    },
    {
      label: "",
      render: (p) => (
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {canEdit && p.status !== "cancelled" && (
            cancelling === p.id ? (
              <span className="flex flex-col gap-1.5 w-48">
                <input aria-label="Reason for cancelling" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is it cancelled?" className={inputClass} />
                <span className="flex gap-3">
                  <button type="button" disabled={!reason.trim() || saving} onClick={() => void confirmCancel(p)} className={`${linkClass} text-danger-700 disabled:opacity-50`}>Confirm cancel</button>
                  <button type="button" onClick={() => { setCancelling(null); setReason(""); }} className={linkClass}>Keep</button>
                </span>
              </span>
            ) : <button type="button" onClick={() => setCancelling(p.id)} className={`${linkClass} text-danger-700`}>Cancel plan</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        kicker={`${site.label} · ${site.sublabel}`}
        title="Delivery plans"
        lede="What is expected to arrive, planned before the truck comes, so the warehouse can prepare. A plan creates no stock and is not the reception. A truck can also arrive with no plan - it is never turned away for lacking one."
        actions={<SiteSwitcher value={site.slug} onChange={(s) => s && switchSite(s)} />}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        <KpiTile label="Active plans" value={totals.plans} />
        <KpiTile label="Overdue" value={loading ? "…" : overdueCount} tone={overdueCount > 0 ? "gap" : "default"} to="?overdue" />
        <KpiTile label="Trucks arrived" value={totals.arrived} />
        <KpiTile label="Accepted" value={totals.accepted} />
        <KpiTile label="Rejected" value={totals.rejected} tone="gap" />
        <KpiTile label="Expected (kg)" value={kg(totals.expectedKg)} />
        <KpiTile label="Received (kg)" value={kg(totals.receivedKg)} />
      </div>

      {canEdit && (
        <CollapsibleCard title="New delivery plan" meta={`for ${site.warehouseName}`}>
          <DeliveryPlanForm
            initial={emptyPlanForm()} warehouseName={site.warehouseName} editing={false} saving={saving}
            onSubmit={(payload) => void run(() => api.createDeliveryPlan({ ...payload, plannedDeliveryDate: today(), destinationWarehouse: site.warehouseName }))}
          />
        </CollapsibleCard>
      )}

      {error && <p role="alert" className="px-1 text-[13px] text-danger-700">{error}</p>}

      <FilterBar>
        <input placeholder="Search plan, supplier, origin, truck, funding ref…" value={search.q} onChange={(e) => search.setQ(e.target.value)} className="w-full sm:w-72" />
      </FilterBar>
      <DataTable
        // Remounts once the plans have loaded (the overdue values to tick aren't known before) and when `?overdue` is
        // followed from this page; a later refetch doesn't, so filters the person changed stay as they are.
        key={overdueOnly ? `overdue-${loading ? "loading" : "ready"}` : "all"}
        initialFilters={overdueFilter}
        columns={columns}
        rows={search.filtered}
        keyFn={(p) => p.id}
        rowHref={(p) => `/${site.slug}/delivery-plans/${p.id}`}
        emptyTitle="No delivery plans yet"
        emptyHint="Add a plan for each delivery you expect, so what arrives can be compared with what was planned."
      />
    </div>
  );
}
