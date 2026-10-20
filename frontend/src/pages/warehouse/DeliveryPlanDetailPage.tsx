import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PLAN_STATUS_LABELS, type PlanStatus } from "@anagroci/contract/domain/deliveryPlan";
import { PageHeader } from "../../components/ui/PageHeader";
import { KpiTile } from "../../components/ui/KpiTile";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { Pill } from "../../components/ui/Pill";
import { ReceiptStatusPill } from "../../components/ReceiptStatusPill";
import { STATUS_LABELS } from "../../domain/receiptStatus";
import { TruckStepTracker } from "../../components/receipt/TruckStepTracker";
import { APPROVAL, PlanFlagList, RECEPTION_TYPE } from "../../components/receipt/PlanBadges";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { DeliveryPlanForm, planFormFrom } from "../../components/receipt/DeliveryPlanForm";
import { useSite } from "../../state/SiteContext";
import { useTracking } from "../../state/TrackingContext";
import { useCanEditDirectly } from "../../state/AuthContext";
import { api } from "../../repository/api";
import type { DeliveryPlanDetail, DeliveryPlanTruck } from "../../types/receipt";
import { normalizeSupplierName } from "@anagroci/contract/domain/supplierCode";
import { FilterBar } from "../../components/ui/FilterBar";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { formatDate, todayIso } from "@anagroci/contract/domain/dateFormat";

const STATUS_TONE: Record<PlanStatus, string> = { planned: "decision", partially_received: "term", delivered: "entry", cancelled: "gap" };
const kg = (n: number | null) => (n === null ? "-" : n.toLocaleString());
const signed = (n: number | null) => (n === null ? "-" : `${n > 0 ? "+" : ""}${n.toLocaleString()}`);

/**
 * One plan and every truck recorded against it: which arrived, which were accepted or rejected (and
 * why), and what each added to stock. The numbers come from the same derivation as the plans table
 * (contract domain/deliveryPlan.ts), so this page and the list can never disagree.
 */
export function DeliveryPlanDetailPage() {
  const { id = "" } = useParams();
  const site = useSite();
  const navigate = useNavigate();
  const canEdit = useCanEditDirectly();
  const { createReceipt } = useTracking();
  const [plan, setPlan] = useState<DeliveryPlanDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => api.getDeliveryPlan(id).then(setPlan).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    setPlan(null);
    setError(null);
    setEditing(false);
    void load();
  }, [id]);

  /** Runs a change to the plan, then shows the plan as it now stands. */
  async function change(action: () => Promise<unknown>, after?: () => void) {
    setActionError(null);
    setSaving(true);
    try { await action(); await load(); after?.(); } catch (e) { setActionError(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  }

  /** A truck has arrived against this plan: open its reception, already linked. */
  async function recordArrival() {
    setActionError(null);
    try {
      const rid = await createReceipt(site.warehouseName, { arrivalDate: todayIso(), deliveryPlanId: id });
      navigate(`/${site.slug}/receipts/${rid}`);
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)); }
  }

  const search = useTableSearch(plan?.trucks ?? [], (t) => [t.receiptId, t.vehicleNo, t.lotNo, t.supplierName]);

  if (error) return <p className="text-sm text-danger-700">{error}</p>;
  if (!plan) return <p className="text-sm text-warmstone-500">Loading…</p>;

  const { progress: p } = plan;
  // "Done" is the point a truck's kg count: its GRN is recorded (status grn_completed or beyond, which a rejected one never is).
  const DONE = new Set(["grn_completed", "in_stock", "in_drying", "transferred_out"]);
  const done = plan.trucks.filter((t) => DONE.has(t.status)).length;
  const inProgress = plan.trucks.filter((t) => !t.rejected && !DONE.has(t.status)).length;
  const columns: Column<DeliveryPlanTruck>[] = [
    { label: "Receipt", nowrap: true, render: (t) => <Link to={`/${site.slug}/receipts/${t.receiptId}`} className="font-mono text-[12.5px] font-semibold text-brand-700 hover:text-brand-800">{t.receiptId}</Link> },
    { label: "Arrived", filter: { value: (t) => t.arrivalDate, kind: "date" }, nowrap: true, render: (t) => formatDate(t.arrivalDate) },
    { label: "Truck", nowrap: true, render: (t) => t.vehicleNo || "-" },
    { label: "Steps", render: (t) => <TruckStepTracker status={t.status} /> },
    { label: "Outcome", filter: { value: (t) => STATUS_LABELS[t.status], kind: "select" }, render: (t) => (
      <span className="inline-flex flex-col items-start gap-1">
        <ReceiptStatusPill status={t.status} />
        {t.rejected && <span className="text-[11.5px] text-danger-700 whitespace-normal max-w-[16rem]">{t.rejectionReason ?? "No reason recorded"}</span>}
      </span>
    ) },
    { label: "GRN (kg)", filter: { value: (t) => t.grnKg, kind: "number" }, nowrap: true, render: (t) => (t.rejected ? "-" : t.grnKg === null ? <span className="text-warmstone-400">awaiting GRN</span> : kg(t.grnKg)) },
    { label: "Lot", nowrap: true, render: (t) => t.lotNo ?? "-" },
    { label: "Against the plan", filter: { value: (t) => RECEPTION_TYPE[t.type].label, kind: "select" }, render: (t) => (
      <span className="inline-flex flex-col items-start gap-1">
        <Pill tone={RECEPTION_TYPE[t.type].tone} label={RECEPTION_TYPE[t.type].label} />
        <PlanFlagList flags={t.flags} />
        {t.approval === "pending" && <span className="text-[10.5px] font-semibold text-ambernut-700">{APPROVAL.pending.label}</span>}
      </span>
    ) },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        kicker={<Link to={`/${site.slug}/delivery-plans`} className="hover:text-warmstone-700">← Delivery plans</Link>}
        title={plan.id}
        lede={`${normalizeSupplierName(plan.supplierName)}${plan.supplierCode ? ` · ${plan.supplierCode}` : ""} → ${plan.destinationWarehouse}${plan.destinationStore ? ` · ${plan.destinationStore}` : ""}. Expected ${plan.expectedDeliveryEnd ? `${formatDate(plan.expectedArrivalDate)} to ${formatDate(plan.expectedDeliveryEnd)}` : formatDate(plan.expectedArrivalDate)}${plan.expectedOrigin ? ` from ${plan.expectedOrigin}` : ""}.`}
        actions={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Pill tone={STATUS_TONE[plan.status]} label={PLAN_STATUS_LABELS[plan.status]} />
            {plan.overdue && <Pill tone="gap" label="Overdue" />}
            {canEdit && plan.status !== "cancelled" && (
              <button type="button" onClick={() => void recordArrival()} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[12.5px] font-bold shadow-sm">
                <span className="material-symbols-outlined text-[17px]">add</span>Record arrival
              </button>
            )}
            {canEdit && (
              <button type="button" onClick={() => setEditing((v) => !v)} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-warmstone-200 bg-white hover:bg-warmstone-50 text-warmstone-800 text-[12.5px] font-semibold">
                <span className="material-symbols-outlined text-[17px]">edit</span>{editing ? "Close" : "Edit"}
              </button>
            )}
            {canEdit && plan.status === "cancelled" && (
              <button type="button" disabled={saving} onClick={() => void change(() => api.updateDeliveryPlan(plan.id, { cancelled: false }))} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-warmstone-200 bg-white hover:bg-warmstone-50 text-warmstone-800 text-[12.5px] font-semibold disabled:opacity-50">
                <span className="material-symbols-outlined text-[17px]">undo</span>Reinstate
              </button>
            )}
          </div>
        )}
      />
      {actionError && <p role="alert" className="text-[13px] text-danger-700">{actionError}</p>}
      {editing && canEdit && (
        <CollapsibleCard title={`Edit ${plan.id}`} meta={`for ${plan.destinationWarehouse}`} defaultOpen>
          <DeliveryPlanForm
            key={plan.id} initial={planFormFrom(plan)} warehouseName={plan.destinationWarehouse} editing saving={saving}
            onSubmit={(payload) => void change(() => api.updateDeliveryPlan(plan.id, payload), () => setEditing(false))}
            onCancel={() => setEditing(false)}
          />
        </CollapsibleCard>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="Expected (kg)" value={kg(plan.expectedQuantityKg)} />
        <KpiTile label="Received (kg)" value={kg(p.actualKg)} />
        <KpiTile label="Remaining (kg)" value={kg(p.remainingKg)} />
        <KpiTile label="Variance (kg)" value={signed(p.varianceKg)} tone={p.varianceKg !== null && p.varianceKg < 0 ? "gap" : "default"} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label={plan.expectedTrucks === null ? "Trucks arrived" : `Trucks arrived (of ${plan.expectedTrucks})`} value={p.arrivals} />
        <KpiTile label="Accepted" value={p.acceptedTrucks} />
        <KpiTile label="Rejected" value={p.rejectedTrucks} tone={p.rejectedTrucks > 0 ? "gap" : "default"} />
        <KpiTile label="Awaiting GRN" value={p.awaitingGrnTrucks} />
      </div>
      {plan.trucks.length > 0 && (
        <p className="text-[13px] text-warmstone-600">
          <span className="font-semibold text-success-700">{done} done</span> (GRN recorded or later)
          {" · "}<span className="font-semibold text-brand-700">{inProgress} in progress</span>
          {" · "}<span className={`font-semibold ${p.rejectedTrucks ? "text-danger-700" : "text-warmstone-500"}`}>{p.rejectedTrucks} rejected</span>
          {plan.fundingReference ? <span className="text-warmstone-400"> · funding ref. {plan.fundingReference}</span> : null}
        </p>
      )}
      {plan.cancelledAt && <p className="text-sm text-danger-700">Cancelled{plan.cancelReason ? `: ${plan.cancelReason}` : ""}</p>}
      {plan.remarks && <p className="text-sm text-warmstone-600">{plan.remarks}</p>}

      <FilterBar>
        <input placeholder="Search receipt, truck or lot…" value={search.q} onChange={(e) => search.setQ(e.target.value)} className="w-full sm:w-72" />
      </FilterBar>
      <DataTable columns={columns} rows={search.filtered} keyFn={(t) => t.receiptId} rowHref={(t) => `/${site.slug}/receipts/${t.receiptId}`} emptyTitle="No truck has arrived against this plan yet" />
    </div>
  );
}
