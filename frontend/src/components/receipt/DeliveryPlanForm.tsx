import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useTracking } from "../../state/TrackingContext";
import type { DeliveryPlanPayload } from "../../repository/api";
import type { DeliveryPlan } from "../../types/receipt";

const inputClass =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700";

export interface PlanFormState {
  supplierName: string; supplierCode: string; origin: string; store: string;
  start: string; end: string; quantity: string; trucks: string; truckType: string; funding: string; remarks: string;
}

const today = () => new Date().toISOString().slice(0, 10);
export const emptyPlanForm = (): PlanFormState => ({
  supplierName: "", supplierCode: "", origin: "", store: "", start: today(), end: "", quantity: "", trucks: "", truckType: "", funding: "", remarks: "",
});

export const planFormFrom = (p: DeliveryPlan): PlanFormState => ({
  supplierName: p.supplierName, supplierCode: p.supplierCode ?? "", origin: p.expectedOrigin ?? "", store: p.destinationStore ?? "",
  start: p.expectedArrivalDate, end: p.expectedDeliveryEnd ?? "", quantity: p.expectedQuantityKg === null ? "" : String(p.expectedQuantityKg),
  trucks: p.expectedTrucks === null ? "" : String(p.expectedTrucks), truckType: p.expectedTruckType ?? "", funding: p.fundingReference ?? "", remarks: p.remarks ?? "",
});

export function toPlanPayload(f: PlanFormState): DeliveryPlanPayload {
  return {
    supplierName: f.supplierName.trim(),
    supplierCode: f.supplierCode.trim() || null,
    expectedOrigin: f.origin.trim() || null,
    destinationStore: f.store || null,
    expectedArrivalDate: f.start,
    expectedDeliveryEnd: f.end || null,
    expectedQuantityKg: f.quantity.trim() ? Number(f.quantity.replace(/\s/g, "").replace(",", ".")) : null,
    expectedTrucks: f.trucks.trim() || null,
    expectedTruckType: f.truckType.trim() || null,
    fundingReference: f.funding.trim() || null,
    remarks: f.remarks.trim() || null,
  };
}

const field = (id: string, label: string, el: ReactNode) => (
  <div>
    <label htmlFor={id} className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">{label}</label>
    {el}
  </div>
);

interface Props {
  initial: PlanFormState;
  /** The site the plan is for: its stores are the destination choices. */
  warehouseName: string;
  editing: boolean;
  saving: boolean;
  onSubmit: (payload: DeliveryPlanPayload) => void;
  onCancel?: () => void;
}

/** The Delivery Plan fields, used to add a plan (list page) and to change one (its own page). */
export function DeliveryPlanForm({ initial, warehouseName, editing, saving, onSubmit, onCancel }: Props) {
  const { masters } = useTracking();
  const [form, setForm] = useState<PlanFormState>(initial);
  const set = <K extends keyof PlanFormState>(k: K, v: PlanFormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const supplierByName = useMemo(() => new Map(masters.suppliers.map((s) => [s.name, s.code])), [masters.suppliers]);
  const stores = useMemo(() => masters.warehouses.filter((w) => w.site === warehouseName).map((w) => w.name), [masters.warehouses, warehouseName]);

  function pickSupplier(name: string) {
    set("supplierName", name);
    // A known supplier brings its code along, so it is not typed twice.
    const code = supplierByName.get(name);
    if (code) set("supplierCode", code);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(toPlanPayload(form));
  }

  return (
    <form onSubmit={handleSubmit} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-3">
      {field("dp-supplier", "Supplier", <>
        <input id="dp-supplier" list="dp-suppliers" required value={form.supplierName} onChange={(e) => pickSupplier(e.target.value)} className={inputClass} placeholder="Start typing a supplier…" />
        <datalist id="dp-suppliers">{masters.suppliers.filter((s) => s.active !== false).map((s) => <option key={s.code} value={s.name} label={s.status === "suspended" ? "suspended" : undefined} />)}</datalist>
        {/* Suspended is a warning, not a block (client decision): the plan can still be made. */}
        {masters.suppliers.find((s) => s.name === form.supplierName)?.status === "suspended" && (
          <p className="mt-1 text-[11.5px] font-semibold text-ambernut-700">This supplier is suspended.</p>
        )}
      </>)}
      {field("dp-code", "Supplier / LBA code", <input id="dp-code" value={form.supplierCode} onChange={(e) => set("supplierCode", e.target.value)} className={inputClass} />)}
      {field("dp-origin", "Expected origin", <>
        <input id="dp-origin" list="dp-origins" value={form.origin} onChange={(e) => set("origin", e.target.value)} className={inputClass} />
        <datalist id="dp-origins">{masters.origins.map((o) => <option key={o} value={o} />)}</datalist>
      </>)}
      {field("dp-store", "Destination store", (
        <select id="dp-store" value={form.store} onChange={(e) => set("store", e.target.value)} className={inputClass}>
          <option value="">Any store at {warehouseName}</option>
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
        {onCancel && <button type="button" onClick={onCancel} className="text-[13px] font-semibold text-warmstone-600 hover:text-warmstone-900">Cancel editing</button>}
        <span className="text-[12px] text-warmstone-500">{editing ? "The destination warehouse is part of the plan's ID and can't change." : "The plan's ID is issued when you add it."}</span>
      </div>
    </form>
  );
}
