import { useState, type FormEvent } from "react";
import { formatKg } from "./batchUi";
import type { LotPermissions } from "./LotEntries";
import { StepCard } from "./StepCard";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { DateInput } from "../ui/DateInput";
import { Field, Input, Select, inputClass } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { Pill } from "../ui/Pill";
import { api, ApiError } from "../../repository/api";
import { STREAMS, TRUCK_STATUS_LABELS, boilerError, streamLabel, truckError, truckNetKg, type StoreBalance } from "@anagroci/contract/domain/byProducts";
import { formatDate, todayIso } from "@anagroci/contract/domain/dateFormat";
import type { BatchLots, BoilerInput, BoilerReadingView, TruckInput, TruckView } from "@anagroci/contract/types/lots";

/**
 * The doc's "By-products & dispatch": what each store holds, one truck form with the stream picked from a list, and the
 * boiler. The stores belong to the factory, not to this batch.
 */
export function ByProductsPanel({ n, data, can, onChanged }: { n: number; data: BatchLots; can: LotPermissions; onChanged: () => void }) {
  const [truck, setTruck] = useState<TruckView | "new" | null>(null);
  const [burning, setBurning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const atGate = data.trucks.filter((t) => t.status !== "closed").length;
  const shell = data.stores.find((s) => s.stream === "shell")!;

  async function removeTruck(t: TruckView) {
    if (!window.confirm(`Remove truck ${t.truckNo}?`)) return;
    setError(null);
    try {
      await api.deleteTruck(t.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function removeReading(b: BoilerReadingView) {
    if (!window.confirm(`Remove the boiler reading of ${formatDate(b.date)}?`)) return;
    setError(null);
    try {
      await api.deleteBoilerReading(b.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  const storeColumns: Column<StoreBalance>[] = [
    { label: "Store", nowrap: true, render: (s) => <b className="font-semibold">{streamLabel(s.stream)}</b> },
    { label: "Produced", align: "right", nowrap: true, render: (s) => formatKg(s.producedKg) },
    { label: "Left by truck", align: "right", nowrap: true, render: (s) => formatKg(s.dispatchedKg) },
    { label: "Burned in the boiler", align: "right", nowrap: true, render: (s) => (s.stream === "shell" ? formatKg(s.burnedKg) : "-") },
    { label: "In the store", align: "right", nowrap: true, render: (s) => <b className="font-semibold">{formatKg(s.stockKg)}</b> },
  ];

  const truckColumns: Column<TruckView>[] = [
    { label: "Date", nowrap: true, render: (t) => formatDate(t.date) },
    { label: "Truck", nowrap: true, render: (t) => <b className="font-semibold">{t.truckNo}</b> },
    { label: "Taking", nowrap: true, render: (t) => streamLabel(t.stream) },
    { label: "Net", align: "right", nowrap: true, render: (t) => (t.netKg === null ? "-" : formatKg(t.netKg)) },
    { label: "Buyer", render: (t) => t.buyer || "-" },
    { label: "Gate pass", nowrap: true, render: (t) => t.gatePassNo || "-" },
    { label: "Status", nowrap: true, render: (t) => <Pill tone={t.status === "closed" ? "entry" : "decision"} label={TRUCK_STATUS_LABELS[t.status]} /> },
    ...(can.canFloor ? [{
      label: "", align: "right" as const, nowrap: true,
      render: (t: TruckView) => (t.status === "closed" ? "" : (
        <span className="inline-flex items-center gap-1">
          <Button variant="secondary" onClick={() => setTruck(t)}>Continue</Button>
          <button type="button" onClick={() => removeTruck(t)} aria-label={`Remove truck ${t.truckNo}`} className="p-1.5 rounded-lg text-warmstone-400 hover:bg-warmstone-100 hover:text-warmstone-700 transition-colors">
            <span className="material-symbols-outlined text-[20px]">delete</span>
          </button>
        </span>
      )),
    }] : []),
  ];

  const boilerColumns: Column<BoilerReadingView>[] = [
    { label: "Date", nowrap: true, render: (b) => formatDate(b.date) },
    { label: "Shell burned", align: "right", nowrap: true, render: (b) => formatKg(Number(b.shellKg)) },
    { label: "Running hours", align: "right", nowrap: true, render: (b) => b.runningHours || "-" },
    ...(can.canFloor ? [{
      label: "", align: "right" as const, nowrap: true,
      render: (b: BoilerReadingView) => (
        <button type="button" onClick={() => removeReading(b)} aria-label={`Remove the boiler reading of ${formatDate(b.date)}`} className="p-1.5 rounded-lg text-warmstone-400 hover:bg-warmstone-100 hover:text-warmstone-700 transition-colors">
          <span className="material-symbols-outlined text-[20px]">delete</span>
        </button>
      ),
    }] : []),
  ];

  return (
    <StepCard n={n} title="By-products and trucks" status={`${formatKg(shell.stockKg)} in the shell silo${atGate ? ` · ${atGate} truck${atGate === 1 ? "" : "s"} still at the gate` : ""}`} active={false} done={false}>
      <div className="space-y-5">
        <div>
          <p className="text-[13px] text-warmstone-800 mb-3">What each store holds, for the whole factory. A store goes down when a truck leaves with its gate pass, or when shell is burned.</p>
          <DataTable columns={storeColumns} rows={data.stores} keyFn={(s) => s.stream} />
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="text-[13px] font-bold text-warmstone-900">Trucks</h4>
            {can.canFloor && <Button icon="add" onClick={() => setTruck("new")}>A truck is at the gate</Button>}
          </div>
          {data.trucks.length > 0 && <DataTable columns={truckColumns} rows={data.trucks} keyFn={(t) => String(t.id)} />}
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="text-[13px] font-bold text-warmstone-900">Boiler</h4>
            {can.canFloor && <Button variant="secondary" icon="add" onClick={() => setBurning(true)}>Record shell burned</Button>}
          </div>
          {data.boiler.length > 0 && <DataTable columns={boilerColumns} rows={data.boiler} keyFn={(b) => String(b.id)} />}
        </div>
        {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}
      </div>
      {truck && (
        <Modal wide title={truck === "new" ? "A truck at the gate" : `Truck ${truck.truckNo}`} onClose={() => setTruck(null)}>
          <TruckForm truck={truck === "new" ? null : truck} stores={data.stores} onSaved={() => { setTruck(null); onChanged(); }} />
        </Modal>
      )}
      {burning && (
        <Modal title="Shell burned in the boiler" onClose={() => setBurning(false)}>
          <BoilerForm shellStockKg={shell.stockKg} onSaved={() => { setBurning(false); onChanged(); }} />
        </Modal>
      )}
    </StepCard>
  );
}

function TruckForm({ truck, stores, onSaved }: { truck: TruckView | null; stores: StoreBalance[]; onSaved: () => void }) {
  const [v, setV] = useState<TruckInput>(truck ?? { date: todayIso(), documentsChecked: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof TruckInput) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [key]: e.target.value }));
  const stock = stores.find((s) => s.stream === v.stream)?.stockKg ?? 0;
  const net = truckNetKg(v);
  const closing = Boolean((v.gatePassNo ?? "").trim());

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = truckError(v, stock);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      if (truck) await api.updateTruck(truck.id, v);
      else await api.addTruck(v);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-[13px] text-warmstone-800">Save as the truck moves: first at the gate, then weighed empty, then loaded. The gate pass closes it.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="What is the truck taking?" hint={v.stream ? `The store holds ${formatKg(stock)}.` : undefined}>
          <Select value={v.stream ?? ""} onChange={set("stream")} disabled={Boolean(truck)}>
            <option value="">Choose…</option>
            {STREAMS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </Select>
        </Field>
        <Field label="Date"><DateInput value={v.date ?? ""} onChange={(d) => setV((p) => ({ ...p, date: d }))} className={inputClass} /></Field>
        <Field label="Truck number"><Input value={v.truckNo ?? ""} onChange={set("truckNo")} /></Field>
        <Field label="Driver (optional)"><Input value={v.driver ?? ""} onChange={set("driver")} /></Field>
      </div>
      <label className="flex items-center gap-2 text-[13px] font-semibold text-warmstone-900 cursor-pointer">
        <input type="checkbox" checked={Boolean(v.documentsChecked)} onChange={(e) => setV((p) => ({ ...p, documentsChecked: e.target.checked }))} />
        The truck's documents are checked
      </label>
      <fieldset disabled={!v.documentsChecked} className={v.documentsChecked ? "" : "opacity-50"}>
        <legend className="block text-[13px] font-bold text-warmstone-900 mb-3">Weighbridge{v.documentsChecked ? "" : " · opens after the documents are checked"}</legend>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Empty, tare (kg)"><Input numeric value={v.tareKg ?? ""} onChange={set("tareKg")} /></Field>
          <Field label="Loaded, gross (kg)"><Input numeric value={v.grossKg ?? ""} onChange={set("grossKg")} /></Field>
          <Field label="Weighbridge slip"><Input value={v.slipNo ?? ""} onChange={set("slipNo")} /></Field>
        </div>
        {net !== null && <p className={`mt-2 text-[13px] tabular-nums ${net > stock || net <= 0 ? "text-danger-700" : "text-warmstone-800"}`}>Net = gross − tare = <b>{formatKg(net)}</b>{net > stock ? ` · more than the ${formatKg(stock)} in the store` : ""}</p>}
      </fieldset>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Buyer or vendor"><Input value={v.buyer ?? ""} onChange={set("buyer")} /></Field>
        <Field label="Category (optional)"><Input value={v.category ?? ""} onChange={set("category")} /></Field>
        <Field label="Price (optional)"><Input numeric value={v.price ?? ""} onChange={set("price")} /></Field>
        <Field label="Gate pass / Sortie no" hint="Filling this in closes the truck: its net weight leaves the store."><Input value={v.gatePassNo ?? ""} onChange={set("gatePassNo")} /></Field>
      </div>
      {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" icon="check" disabled={saving}>{closing ? "Close the truck" : "Save the truck"}</Button>
      </div>
    </form>
  );
}

function BoilerForm({ shellStockKg, onSaved }: { shellStockKg: number; onSaved: () => void }) {
  const [v, setV] = useState<BoilerInput>({ date: todayIso() });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = boilerError(v, shellStockKg);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      await api.addBoilerReading(v);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Date"><DateInput value={v.date ?? ""} onChange={(d) => setV((p) => ({ ...p, date: d }))} className={inputClass} /></Field>
      <Field label="Shell burned (kg)" hint={`The shell silo holds ${formatKg(shellStockKg)}.`}><Input numeric value={v.shellKg ?? ""} onChange={(e) => setV((p) => ({ ...p, shellKg: e.target.value }))} /></Field>
      <Field label="Running hours (optional)"><Input numeric value={v.runningHours ?? ""} onChange={(e) => setV((p) => ({ ...p, runningHours: e.target.value }))} /></Field>
      {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" icon="check" disabled={saving}>Save the reading</Button>
      </div>
    </form>
  );
}
