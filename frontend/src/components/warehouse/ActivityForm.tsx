import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ACTIVITY_CATEGORIES, activityProblems, categoryById, type ActivityCategoryId } from "@anagroci/contract/data/warehouseActivities";
import { api } from "../../repository/api";
import type { ReceiptRecord } from "../../types/receipt";

const inputCls =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-white text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none focus:border-brand-700 focus:ring-1 focus:ring-brand-700";
const field = (label: string, el: ReactNode, hint?: string) => (
  <label className="block">
    <span className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">{label}</span>
    {el}
    {hint && <span className="block mt-1 text-[11.5px] text-warmstone-500">{hint}</span>}
  </label>
);

interface Props {
  /** The warehouse the activity is recorded at: its Lots and places are the choices. */
  warehouse: string;
  receipts: ReceiptRecord[];
  /** Stores of this warehouse and known Bins. */
  places: string[];
  onSaved: () => void;
}

/**
 * Records an "other warehouse activity" (stacking, destacking, re-bagging, triage…) against a Lot and a place, in one of the
 * fixed categories (contract data/warehouseActivities.ts). The rules shown here are the ones the server applies (activityProblems),
 * so the form and the server cannot disagree. Triage asks for its own moisture and quantity before and after.
 */
export function ActivityForm({ warehouse, receipts, places, onSaved }: Props) {
  const [v, setV] = useState({ category: "" as ActivityCategoryId | "", date: new Date().toISOString().slice(0, 10), lotNo: "", locationFrom: "", locationTo: "", bags: "", moisturePct: "", quantityBeforeKg: "", quantityAfterKg: "", remarks: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const set = (k: keyof typeof v, val: string) => setV((s) => ({ ...s, [k]: val }));
  const cat = v.category ? categoryById(v.category) : null;
  const lots = useMemo(() => receipts.filter((r) => r.warehouse === warehouse && r.lotNo).map((r) => ({ lot: r.lotNo!, label: `${r.lotNo} · ${r.supplierName || r.vehicleNo || r.id}` })).sort((a, b) => a.lot.localeCompare(b.lot)), [receipts, warehouse]);
  const problems = v.category ? activityProblems(v) : [];

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.createActivityEntry({ ...v, warehouse });
      setNotice(`${cat!.label} recorded.`);
      setV((s) => ({ ...s, lotNo: "", bags: "", moisturePct: "", quantityBeforeKg: "", quantityAfterKg: "", remarks: "" }));
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="space-y-4 pt-3">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {field("Kind of activity *", (
          <select required value={v.category} onChange={(e) => set("category", e.target.value)} className={inputCls}>
            <option value="">Choose…</option>
            {ACTIVITY_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}{c.useDryingForm ? " (recorded on the truck)" : ""}</option>)}
          </select>
        ))}
        {field("Date", <input type="date" value={v.date} onChange={(e) => set("date", e.target.value)} className={inputCls} />, "Today unless you change it")}
        {field(cat?.needsLot ? "Lot *" : "Lot (optional)", (
          <select value={v.lotNo} onChange={(e) => set("lotNo", e.target.value)} className={inputCls}>
            <option value="">{cat?.needsLot ? "Choose the Lot…" : "No Lot"}</option>
            {lots.map((l) => <option key={l.lot} value={l.lot}>{l.label}</option>)}
          </select>
        ), "The activity stays linked to this Lot's stock")}
        {field(cat?.needsTwoLocations ? "Moved from *" : "Where *", (
          <select value={v.locationFrom} onChange={(e) => set("locationFrom", e.target.value)} className={inputCls}>
            <option value="">Choose a store or bin…</option>{places.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        ))}
        {cat?.needsTwoLocations && field("Moved to *", (
          <select value={v.locationTo} onChange={(e) => set("locationTo", e.target.value)} className={inputCls}>
            <option value="">Choose a store or bin…</option>{places.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        ))}
        {field("Bags", <input inputMode="numeric" value={v.bags} onChange={(e) => set("bags", e.target.value)} className={inputCls} />)}
        {cat?.needsQuality && (
          <>
            {field("Moisture (%) *", <input inputMode="decimal" value={v.moisturePct} onChange={(e) => set("moisturePct", e.target.value)} className={inputCls} />, "Triage changes moisture, so it is recorded")}
            {field("Kg before *", <input inputMode="decimal" value={v.quantityBeforeKg} onChange={(e) => set("quantityBeforeKg", e.target.value)} className={inputCls} />)}
            {field("Kg after *", <input inputMode="decimal" value={v.quantityAfterKg} onChange={(e) => set("quantityAfterKg", e.target.value)} className={inputCls} />)}
          </>
        )}
        {field(v.category === "other" ? "Remarks *" : "Remarks", <input value={v.remarks} onChange={(e) => set("remarks", e.target.value)} className={inputCls} />)}
      </div>
      {v.category && problems.length > 0 && <ul className="text-[12.5px] text-ambernut-800 list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {error && <p role="alert" className="text-[13px] font-medium text-danger-700 bg-danger-100 rounded-lg px-3 py-2">{error}</p>}
      {notice && <p className="text-[13px] text-success-700">{notice}</p>}
      <button type="submit" disabled={busy || !v.category || problems.length > 0} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold shadow-sm disabled:opacity-50">
        <span className="material-symbols-outlined text-[17px]">add</span>{busy ? "Saving…" : "Record activity"}
      </button>
    </form>
  );
}
