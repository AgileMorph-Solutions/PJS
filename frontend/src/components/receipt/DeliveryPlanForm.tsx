import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useTracking } from "../../state/TrackingContext";
import type { DeliveryPlanPayload } from "../../repository/api";
import type { DeliveryPlan } from "../../types/receipt";
import { todayIso } from "@anagroci/contract/domain/dateFormat";
import { DateInput } from "../ui/DateInput";
import { SearchSelect } from "../ui/SearchSelect";
import { Button } from "../ui/Button";
import { Input, inputClass } from "../ui/Input";
import { isUnlistedOrigin } from "@anagroci/contract/domain/origin";
import { UNLISTED_ORIGIN } from "./originPicker";


export interface PlanFormState {
  supplierName: string; supplierCode: string; origin: string; store: string;
  start: string; end: string; quantity: string; trucks: string; truckType: string; funding: string; remarks: string;
}

const today = todayIso;
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
    <label htmlFor={id} className="block text-[12px] font-semibold text-warmstone-700 mb-1.5">{label}</label>
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
  const { masters, refreshMasters } = useTracking();
  const [form, setForm] = useState<PlanFormState>(initial);
  const set = <K extends keyof PlanFormState>(k: K, v: PlanFormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const supplierByName = useMemo(() => new Map(masters.suppliers.map((s) => [s.name, s.code])), [masters.suppliers]);
  // Picked from the supplier master (26 Nov 2026: the shared searchable dropdown, as Origin already is). An older plan's
  // supplier the master lacks stays shown and kept.
  const supplierOptions = useMemo(() => masters.suppliers.filter((s) => s.active !== false)
    .map((s) => ({ value: s.name, label: s.name, detail: s.status === "suspended" ? `${s.code} · suspended` : s.code })), [masters.suppliers]);
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
        <SearchSelect id="dp-supplier" value={form.supplierName} options={supplierOptions} onOpen={refreshMasters} onChange={pickSupplier} placeholder="Choose a supplier…" clearable={false} />
        {/* Suspended is a warning, not a block (client decision): the plan can still be made. */}
        {masters.suppliers.find((s) => s.name === form.supplierName)?.status === "suspended" && (
          <p className="mt-1 text-[12px] font-semibold text-ambernut-700">This supplier is suspended.</p>
        )}
      </>)}
      {field("dp-code", "Supplier / LBA code", <Input id="dp-code" value={form.supplierCode} onChange={(e) => set("supplierCode", e.target.value)} />)}
      {field("dp-origin", "Expected origin", <>
        {/* Picked from Masters › Origins, never typed (Nov 2026). An older plan's town that the master lacks stays listed first. */}
        <SearchSelect id="dp-origin" value={form.origin} options={masters.origins} onOpen={refreshMasters} onChange={(v) => set("origin", v)} placeholder="Choose an origin…" />
        {isUnlistedOrigin(form.origin, masters.origins) && <p className="mt-1 text-[12px] font-semibold text-ambernut-700">{UNLISTED_ORIGIN}</p>}
      </>)}
      {/* Only where old store rows still exist under the warehouse (the workbook's WH NO.); otherwise the plan is simply
          for the warehouse itself and there is nothing to pick. */}
      {stores.length > 0 && field("dp-store", "Store (WH NO.)", (
        <SearchSelect id="dp-store" value={form.store} options={stores} onChange={(v) => set("store", v)} placeholder={`Anywhere in ${warehouseName}`} />
      ))}
      {field("dp-start", "Expected delivery from", <DateInput id="dp-start" required value={form.start} onChange={(d) => set("start", d)} className={inputClass} />)}
      {field("dp-end", "Expected delivery until", <DateInput id="dp-end" value={form.end} min={form.start} onChange={(d) => set("end", d)} className={inputClass} />)}
      {field("dp-qty", "Expected quantity (kg)", <Input id="dp-qty" numeric required={!editing || form.quantity.trim() !== ""} value={form.quantity} onChange={(e) => set("quantity", e.target.value)} />)}
      {field("dp-trucks", "Expected number of trucks", <Input id="dp-trucks" numeric inputMode="numeric" value={form.trucks} onChange={(e) => set("trucks", e.target.value)} />)}
      {field("dp-truck", "Expected truck type", <Input id="dp-truck" value={form.truckType} onChange={(e) => set("truckType", e.target.value)} />)}
      {field("dp-funding", "Purchase / funding reference", <Input id="dp-funding" value={form.funding} onChange={(e) => set("funding", e.target.value)} placeholder="If there is one" />)}
      {field("dp-remarks", "Remarks", <Input id="dp-remarks" value={form.remarks} onChange={(e) => set("remarks", e.target.value)} />)}
      <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3">
        {onCancel && <Button variant="secondary" onClick={onCancel}>Cancel editing</Button>}
        <Button type="submit" icon={editing ? "save" : "add"} disabled={saving || !form.supplierName.trim()}>{editing ? "Save plan" : "Add plan"}</Button>
        <span className="text-[12px] text-warmstone-500">{editing ? "The destination warehouse is part of the plan's ID and can't change." : "The plan's ID is issued when you add it."}</span>
      </div>
    </form>
  );
}
