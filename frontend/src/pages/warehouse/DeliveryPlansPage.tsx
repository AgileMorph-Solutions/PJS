import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PLAN_STATUS_LABELS, type PlanStatus } from "@anagroci/contract/domain/deliveryPlan";
import { PageHeader } from "../../components/ui/PageHeader";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { Pill } from "../../components/ui/Pill";
import { KpiTile } from "../../components/ui/KpiTile";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { useTracking, useDeliveryPlans } from "../../state/TrackingContext";
import { useSite, useSwitchSite } from "../../state/SiteContext";
import { useCanEditDirectly } from "../../state/AuthContext";
import { api, type DeliveryPlanPayload } from "../../repository/api";
import type { DeliveryPlan } from "../../types/receipt";
import { normalizeSupplierName } from "@anagroci/contract/domain/supplierCode";

const STATUS_TONE: Record<PlanStatus, string> = { planned: "decision", partially_received: "term", delivered: "entry", cancelled: "gap" };

const inputClass =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700";

const today = () => new Date().toISOString().slice(0, 10);
const kg = (n: number | null) => (n === null ? "-" : n.toLocaleString());
/** "3 of 5 arrived · 2 accepted · 1 rejected" — only the parts that are non-zero, so a quiet plan reads short. */
function truckCounts(p: DeliveryPlan): string {
  const { arrivals, acceptedTrucks, rejectedTrucks, awaitingGrnTrucks } = p.progress;
  const parts = [`${arrivals}${p.expectedTrucks === null ? "" : ` of ${p.expectedTrucks}`} arrived`];
  if (arrivals > 0) parts.push(`${acceptedTrucks} accepted`);
  if (rejectedTrucks > 0) parts.push(`${rejectedTrucks} rejected`);
  if (awaitingGrnTrucks > 0) parts.push(`${awaitingGrnTrucks} awaiting GRN`);
  return parts.join(" · ");
}

interface FormState {
  supplierName: string; supplierCode: string; origin: string; store: string;
  start: string; end: string; quantity: string; trucks: string; truckType: string; funding: string; remarks: string;
}
const EMPTY: FormState = { supplierName: "", supplierCode: "", origin: "", store: "", start: today(), end: "", quantity: "", trucks: "", truckType: "", funding: "", remarks: "" };

const fromPlan = (p: DeliveryPlan): FormState => ({
  supplierName: p.supplierName, supplierCode: p.supplierCode ?? "", origin: p.expectedOrigin ?? "", store: p.destinationStore ?? "",
  start: p.expectedArrivalDate, end: p.expectedDeliveryEnd ?? "", quantity: p.expectedQuantityKg === null ? "" : String(p.expectedQuantityKg),
  trucks: p.expectedTrucks === null ? "" : String(p.expectedTrucks), truckType: p.expectedTruckType ?? "", funding: p.fundingReference ?? "", remarks: p.remarks ?? "",
});

/**
 * What is expected to arrive, recorded before the truck comes — a pre-alert, so the warehouse can
 * prepare space, people, weighbridge and quality control. One plan covers several trucks, and a
 * truck may still arrive with no plan at all. The plan creates no stock and is not the reception:
 * everything under "Received" is derived from the trucks recorded against it, never typed here.
 */
export function DeliveryPlansPage() {
  const site = useSite();
  const switchSite = useSwitchSite();
  const navigate = useNavigate();
  const canEdit = useCanEditDirectly();
  const { masters, createReceipt } = useTracking();
  const { plans, refetch } = useDeliveryPlans(site.warehouseName);
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
  const [form, setForm] = useState<FormState>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const supplierByName = useMemo(() => new Map(masters.suppliers.map((s) => [s.name, s.code])), [masters.suppliers]);
  const stores = useMemo(() => masters.warehouses.filter((w) => w.site === site.warehouseName).map((w) => w.name), [masters.warehouses, site.warehouseName]);

  function pickSupplier(name: string) {
    set("supplierName", name);
    // A known supplier brings its code along, so it is not typed twice.
    const code = supplierByName.get(name);
    if (code) set("supplierCode", code);
  }

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setSaving(true);
    try { await action(); await refetch(); return true; } catch (err) { setError(err instanceof Error ? err.message : String(err)); return false; } finally { setSaving(false); }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const payload: DeliveryPlanPayload = {
      supplierName: form.supplierName.trim(),
      supplierCode: form.supplierCode.trim() || null,
      expectedOrigin: form.origin.trim() || null,
      destinationStore: form.store || null,
      expectedArrivalDate: form.start,
      expectedDeliveryEnd: form.end || null,
      expectedQuantityKg: form.quantity.trim() ? Number(form.quantity.replace(/\s/g, "").replace(",", ".")) : null,
      expectedTrucks: form.trucks.trim() || null,
      expectedTruckType: form.truckType.trim() || null,
      fundingReference: form.funding.trim() || null,
      remarks: form.remarks.trim() || null,
    };
    const ok = await run(() => (editing ? api.updateDeliveryPlan(editing, payload) : api.createDeliveryPlan({ ...payload, plannedDeliveryDate: today(), destinationWarehouse: site.warehouseName })));
    if (ok) { setForm(EMPTY); setEditing(null); }
  }

  async function recordArrival(plan: DeliveryPlan) {
    setError(null);
    try {
      const id = await createReceipt(site.warehouseName, { arrivalDate: today(), deliveryPlanId: plan.id });
      await refetch();
      navigate(`/${site.slug}/receipts/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function confirmCancel(plan: DeliveryPlan) {
    if (await run(() => api.updateDeliveryPlan(plan.id, { cancelled: true, cancelReason: reason }))) { setCancelling(null); setReason(""); }
  }

  const linkClass = "text-[11.5px] font-semibold text-brand-700 hover:text-brand-800 whitespace-nowrap";
  const columns: Column<DeliveryPlan>[] = [
    { label: "Plan", nowrap: true, render: (p) => <Link to={`/${site.slug}/delivery-plans/${p.id}`} className="font-mono text-[12.5px] text-brand-700 hover:text-brand-800 font-semibold">{p.id}</Link> },
    { label: "Supplier", render: (p) => <span>{normalizeSupplierName(p.supplierName)}{p.supplierCode ? <span className="text-warmstone-400"> · {p.supplierCode}</span> : null}</span> },
    { label: "Origin", render: (p) => p.expectedOrigin || "-" },
    { label: "Destination", render: (p) => <span>{p.destinationWarehouse}{p.destinationStore ? <span className="text-warmstone-400"> · {p.destinationStore}</span> : null}</span> },
    { label: "Expected delivery", nowrap: true, render: (p) => (p.expectedDeliveryEnd ? `${p.expectedArrivalDate} → ${p.expectedDeliveryEnd}` : p.expectedArrivalDate) },
    { label: "Expected (kg)", nowrap: true, render: (p) => kg(p.expectedQuantityKg) },
    { label: "Received (kg)", nowrap: true, render: (p) => kg(p.progress.actualKg) },
    { label: "Remaining (kg)", nowrap: true, render: (p) => kg(p.progress.remainingKg) },
    { label: "Variance (kg)", nowrap: true, render: (p) => (p.progress.varianceKg === null ? "-" : `${p.progress.varianceKg > 0 ? "+" : ""}${p.progress.varianceKg.toLocaleString()}`) },
    {
      label: "Trucks", nowrap: true,
      render: (p) => truckCounts(p),
    },
    {
      label: "Status", nowrap: true,
      render: (p) => (
        <span className="inline-flex flex-col items-start gap-1">
          <Pill tone={STATUS_TONE[p.status]} label={PLAN_STATUS_LABELS[p.status]} />
          {p.overdue && <span className="text-[10.5px] font-semibold text-danger-700">overdue</span>}
        </span>
      ),
    },
    { label: "Funding ref.", nowrap: true, render: (p) => p.fundingReference || "-" },
    {
      label: "",
      render: (p) => (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 w-72">
          {p.receiptIds.map((rid) => <Link key={rid} to={`/${site.slug}/receipts/${rid}`} className={`${linkClass} font-mono`}>{rid}</Link>)}
          {canEdit && p.status !== "cancelled" && <button type="button" onClick={() => void recordArrival(p)} className={linkClass}>Record arrival</button>}
          {canEdit && <button type="button" onClick={() => { setEditing(p.id); setForm(fromPlan(p)); window.scrollTo({ top: 0, behavior: "smooth" }); }} className={linkClass}>Edit</button>}
          {canEdit && p.status === "cancelled" && <button type="button" onClick={() => void run(() => api.updateDeliveryPlan(p.id, { cancelled: false }))} className={linkClass}>Reinstate</button>}
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
          {p.status === "cancelled" && p.cancelReason && <span className="text-[11px] text-warmstone-500 max-w-[12rem] whitespace-normal">{p.cancelReason}</span>}
        </div>
      ),
    },
  ];

  const field = (id: string, label: string, el: React.ReactNode) => (
    <div>
      <label htmlFor={id} className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">{label}</label>
      {el}
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        kicker={`${site.label} · ${site.sublabel}`}
        title="Delivery plans"
        lede="What is expected to arrive, planned before the truck comes, so the warehouse can prepare. A plan creates no stock and is not the reception. A truck can also arrive with no plan - it is never turned away for lacking one."
        actions={<SiteSwitcher value={site.slug} onChange={(s) => s && switchSite(s)} />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <KpiTile label="Active plans" value={totals.plans} />
        <KpiTile label="Trucks arrived" value={totals.arrived} />
        <KpiTile label="Accepted" value={totals.accepted} />
        <KpiTile label="Rejected" value={totals.rejected} tone="gap" />
        <KpiTile label="Expected (kg)" value={kg(totals.expectedKg)} />
        <KpiTile label="Received (kg)" value={kg(totals.receivedKg)} />
      </div>

      {canEdit && (
        <CollapsibleCard title={editing ? `Edit ${editing}` : "New delivery plan"} meta={`for ${site.warehouseName}`}>
          <form onSubmit={handleSubmit} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-3">
            {field("dp-supplier", "Supplier", <>
              <input id="dp-supplier" list="dp-suppliers" required value={form.supplierName} onChange={(e) => pickSupplier(e.target.value)} className={inputClass} placeholder="Start typing a supplier…" />
              <datalist id="dp-suppliers">{masters.suppliers.filter((s) => s.active !== false).map((s) => <option key={s.code} value={s.name} />)}</datalist>
            </>)}
            {field("dp-code", "Supplier / LBA code", <input id="dp-code" value={form.supplierCode} onChange={(e) => set("supplierCode", e.target.value)} className={inputClass} />)}
            {field("dp-origin", "Expected origin", <>
              <input id="dp-origin" list="dp-origins" value={form.origin} onChange={(e) => set("origin", e.target.value)} className={inputClass} />
              <datalist id="dp-origins">{masters.origins.map((o) => <option key={o} value={o} />)}</datalist>
            </>)}
            {field("dp-store", "Destination store", (
              <select id="dp-store" value={form.store} onChange={(e) => set("store", e.target.value)} className={inputClass}>
                <option value="">Any store at {site.warehouseName}</option>
                {stores.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            ))}
            {field("dp-start", "Expected delivery from", <input id="dp-start" type="date" required value={form.start} onChange={(e) => set("start", e.target.value)} className={inputClass} />)}
            {field("dp-end", "Expected delivery until", <input id="dp-end" type="date" value={form.end} min={form.start} onChange={(e) => set("end", e.target.value)} className={inputClass} />)}
            {field("dp-qty", "Expected quantity (kg)", <input id="dp-qty" inputMode="decimal" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} className={inputClass} />)}
            {field("dp-trucks", "Expected number of trucks", <input id="dp-trucks" inputMode="numeric" value={form.trucks} onChange={(e) => set("trucks", e.target.value)} className={inputClass} />)}
            {field("dp-truck", "Expected truck type", <input id="dp-truck" value={form.truckType} onChange={(e) => set("truckType", e.target.value)} className={inputClass} />)}
            {field("dp-funding", "Purchase / funding reference", <input id="dp-funding" value={form.funding} onChange={(e) => set("funding", e.target.value)} className={inputClass} placeholder="If there is one" />)}
            {field("dp-remarks", "Remarks", <input id="dp-remarks" value={form.remarks} onChange={(e) => set("remarks", e.target.value)} className={inputClass} />)}
            <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3">
              <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold transition-all shadow-sm disabled:opacity-50">
                <span className="material-symbols-outlined text-[17px]">{editing ? "save" : "add"}</span>
                {editing ? "Save plan" : "Add plan"}
              </button>
              {editing && <button type="button" onClick={() => { setEditing(null); setForm(EMPTY); }} className="text-[13px] font-semibold text-warmstone-600 hover:text-warmstone-900">Cancel editing</button>}
              <span className="text-[12px] text-warmstone-500">{editing ? "The destination warehouse is part of the plan's ID and can't change." : "The plan's ID is issued when you add it."}</span>
            </div>
          </form>
        </CollapsibleCard>
      )}

      {error && <p role="alert" className="px-1 text-[13px] text-danger-700">{error}</p>}

      <FilterBar>
        <input placeholder="Search plan, supplier, origin, truck, funding ref…" value={search.q} onChange={(e) => search.setQ(e.target.value)} className="w-full sm:w-72" />
      </FilterBar>
      <DataTable
        columns={columns}
        rows={search.filtered}
        keyFn={(p) => p.id}
        emptyTitle="No delivery plans yet"
        emptyHint="Add a plan for each delivery you expect, so what arrives can be compared with what was planned."
      />
    </div>
  );
}
