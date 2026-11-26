import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ACTIVITY_CATEGORIES, activityProblems, activityWarnings, categoryById, type ActivityCategoryId } from "@anagroci/contract/data/warehouseActivities";
import { api } from "../../repository/api";
import type { ReceiptRecord } from "../../types/receipt";
import { todayIso } from "@anagroci/contract/domain/dateFormat";
import { DateInput } from "../ui/DateInput";
import { Button } from "../ui/Button";
import { Field, Input, inputClass } from "../ui/Input";
import { SearchSelect } from "../ui/SearchSelect";

// The app's own boxes and searchable dropdowns (ui/Input, ui/SearchSelect; 26 Nov 2026), like every other form.
const inputCls = inputClass;
const field = (label: string, el: ReactNode, hint?: string) => <Field label={label} hint={hint}>{el}</Field>;

interface Props {
  /** The warehouse the activity is recorded at: its Lots and places are the choices. */
  warehouse: string;
  receipts: ReceiptRecord[];
  /** Stores of this warehouse and known Bins. */
  places: string[];
  /** The Bin the activity is done on, when recorded from that Bin's page: "Where" (or "Moved from") is then that Bin. */
  place?: string;
  onSaved: () => void;
}

/**
 * Records an "other warehouse activity" (stacking, destacking, re-bagging, triage…) on a place — a Bin, since 22 Nov 2026 — in
 * one of the fixed categories (contract data/warehouseActivities.ts); naming a Lot is optional. The rules shown here are the ones
 * the server applies (activityProblems), so the form and the server cannot disagree. Triage asks for its own moisture and quantity
 * before and after.
 */
export function ActivityForm({ warehouse, receipts, places, place, onSaved }: Props) {
  const [v, setV] = useState({ category: "" as ActivityCategoryId | "", date: todayIso(), lotNo: "", locationFrom: place ?? "", locationTo: "", bags: "", moisturePct: "", quantityBeforeKg: "", quantityAfterKg: "", remarks: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const set = (k: keyof typeof v, val: string) => setV((s) => ({ ...s, [k]: val }));
  const cat = v.category ? categoryById(v.category) : null;
  const lots = useMemo(() => receipts.filter((r) => r.warehouse === warehouse && r.lotNo).map((r) => ({ lot: r.lotNo!, who: r.supplierName || r.vehicleNo || r.id })).sort((a, b) => a.lot.localeCompare(b.lot)), [receipts, warehouse]);
  const problems = v.category ? activityProblems(v) : [];
  // Outside the usual range of the 2026 workbooks: shown, never holding the save back (contract activityWarnings).
  const warnings = v.category ? activityWarnings(v) : [];

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.createActivityEntry({ ...v, warehouse });
      setNotice(`${cat!.label} recorded.`);
      setV((s) => ({ ...s, lotNo: "", locationTo: "", bags: "", moisturePct: "", quantityBeforeKg: "", quantityAfterKg: "", remarks: "" }));
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="space-y-4 pt-3">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {field("Kind of activity *", (
          <SearchSelect
            id="activity-category" value={v.category} clearable={false} placeholder="Choose…" onChange={(c) => set("category", c)}
            options={ACTIVITY_CATEGORIES.map((c) => ({ value: c.id, label: c.label, ...(c.useDryingForm ? { detail: "its own section" } : {}) }))}
          />
        ))}
        {field("Date", <DateInput value={v.date} onChange={(d) => set("date", d)} className={inputCls} />, "Today unless you change it")}
        {field(cat?.needsLot ? "Lot *" : "Lot (optional)", (
          <SearchSelect
            id="activity-lot" value={v.lotNo} placeholder={cat?.needsLot ? "Choose the Lot…" : "No Lot"} onChange={(l) => set("lotNo", l)}
            options={lots.map((l) => ({ value: l.lot, label: l.lot, detail: l.who }))}
          />
        ), "Only when the work was on one Lot's bags")}
        {field(cat?.needsTwoLocations ? "Moved from *" : "Where *", place
          ? <input readOnly value={place} className={`${inputCls} bg-warmstone-100 cursor-default`} />
          : (
            <SearchSelect id="activity-from" value={v.locationFrom} options={places} placeholder="Choose a Bin…" onChange={(p) => set("locationFrom", p)} />
          ))}
        {cat?.needsTwoLocations && field("Moved to *", (
          <SearchSelect id="activity-to" value={v.locationTo} options={places.filter((p) => p !== place && p !== v.locationFrom)} placeholder="Choose a Bin…" onChange={(p) => set("locationTo", p)} />
        ))}
        {field("Bags", <Input numeric inputMode="numeric" value={v.bags} onChange={(e) => set("bags", e.target.value)} />)}
        {cat?.needsQuality && (
          <>
            {field("Moisture (%) *", <Input numeric value={v.moisturePct} onChange={(e) => set("moisturePct", e.target.value)} />, "Triage changes moisture, so it is recorded")}
            {field("Kg before *", <Input numeric value={v.quantityBeforeKg} onChange={(e) => set("quantityBeforeKg", e.target.value)} />)}
            {field("Kg after *", <Input numeric value={v.quantityAfterKg} onChange={(e) => set("quantityAfterKg", e.target.value)} />)}
          </>
        )}
        {field(v.category === "other" ? "Remarks *" : "Remarks", <Input value={v.remarks} onChange={(e) => set("remarks", e.target.value)} />)}
      </div>
      {v.category && problems.length > 0 && <ul className="text-[12px] text-ambernut-800 list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {warnings.length > 0 && <ul role="status" className="text-[12px] text-warmstone-700 list-disc pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {error && <p role="alert" className="text-[13px] font-medium text-danger-700 bg-danger-100 rounded-lg px-3 py-2">{error}</p>}
      {notice && <p className="text-[13px] text-success-700">{notice}</p>}
      <Button type="submit" icon="add" disabled={busy || !v.category || problems.length > 0}>{busy ? "Saving…" : "Record activity"}</Button>
    </form>
  );
}
