import { useState, type FormEvent } from "react";
import { emptyBagReceiptProblems } from "@anagroci/contract/domain/juteEmptyBagReceipt";
import { todayIso } from "@anagroci/contract/domain/dateFormat";
import { api } from "../../repository/api";
import { DateInput } from "../ui/DateInput";
import { field, inputCls } from "./receiptFormParts";

interface Props {
  /** Where the bags are received: their warehouse stock goes up here. */
  warehouse: string;
  /** The warehouses they can have come from. */
  fromOptions: string[];
  onSaved: () => void;
}

/** Records empty bags arriving from another warehouse. The rules shown are the ones the server applies (emptyBagReceiptProblems). */
export function EmptyBagReceiptForm({ warehouse, fromOptions, onSaved }: Props) {
  const blank = () => ({
    // With only one other warehouse there is nothing to choose.
    fromWarehouse: fromOptions.length === 1 ? fromOptions[0]! : "",
    date: todayIso(),
    truckNumber: "",
    warehouseReceiptNo: "",
    bagsReceived: "",
    responsibleParty: "",
  });
  const [v, setV] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const set = (k: keyof typeof v, val: string) => {
    setV((s) => ({ ...s, [k]: val }));
    setNotice(null);
  };

  const problems = emptyBagReceiptProblems(v, warehouse);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = await api.createEmptyBagReceipt({ ...v, warehouse });
      setNotice(`${saved.bagsReceived.toLocaleString()} bags added to the warehouse stock at ${saved.warehouse}.`);
      setV(blank());
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="space-y-4 pt-3">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {field("From warehouse *", (
          <select value={v.fromWarehouse} onChange={(e) => set("fromWarehouse", e.target.value)} className={inputCls}>
            <option value="">Choose a warehouse…</option>
            {fromOptions.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        ))}
        {field("Receiving warehouse", <input readOnly tabIndex={-1} value={warehouse} className={`${inputCls} bg-warmstone-50`} />)}
        {field("Date received *", <DateInput value={v.date} onChange={(d) => set("date", d)} className={inputCls} />)}
        {field("Bags received *", <input inputMode="numeric" value={v.bagsReceived} onChange={(e) => set("bagsReceived", e.target.value)} className={inputCls} />)}
        {field("Truck number", <input value={v.truckNumber} onChange={(e) => set("truckNumber", e.target.value)} className={inputCls} />)}
        {field("Warehouse receipt no.", <input value={v.warehouseReceiptNo} onChange={(e) => set("warehouseReceiptNo", e.target.value)} className={inputCls} />)}
        {field("Responsible person/team *", <input value={v.responsibleParty} onChange={(e) => set("responsibleParty", e.target.value)} className={inputCls} />)}
      </div>
      {error && <p role="alert" className="text-[13px] font-medium text-danger-700 bg-danger-100 rounded-lg px-3 py-2">{error}</p>}
      {notice && <p className="text-[13px] text-success-700">{notice}</p>}
      <button
        type="submit"
        disabled={busy || problems.length > 0}
        title={problems.join(" ")}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="material-symbols-outlined text-[17px]">add</span>{busy ? "Saving…" : "Save receipt"}
      </button>
    </form>
  );
}
